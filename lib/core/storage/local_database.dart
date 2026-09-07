import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

/// The app's ONE local database.
///
/// `sqflite` and `path` have been dependencies since the first commit and
/// nothing opened a database with them; the outbox lived in a `Map` on a
/// controller that Riverpod disposed when the user left the conversation. This
/// is the layer that was always intended (`providers.dart`: "overridden once the
/// sqlite layer is wired") and it is deliberately singular. A second, unrelated
/// database would give the app two answers to "what is queued" and no way to
/// decide between them.
///
/// ## What may and may not live here
///
/// Queued work, cached reads, and anything the app must still know after being
/// killed. NOT tokens: those go to the platform keychain through
/// `SecureTokenStore`, because this file is ordinary application-sandbox
/// storage and a rooted device or a filesystem backup reads it.
///
/// ## Migrations
///
/// `onCreate` builds the current schema; `onUpgrade` walks a version at a time.
/// Both are exercised by the tests, because a migration that has never run is a
/// migration that does not work.
class AppDatabase {
  AppDatabase._(this.db);

  final Database db;

  /// Bumped whenever the schema below changes. Every bump needs a case in
  /// [_upgrade], or an existing install will open a database missing the
  /// columns the code expects.
  static const schemaVersion = 2;

  static const _fileName = 'jawwid_chat.db';

  /// Opens (and migrates) the database in the platform's databases directory.
  static Future<AppDatabase> open({String? path}) async {
    final resolved = path ?? p.join(await getDatabasesPath(), _fileName);
    final db = await openDatabase(
      resolved,
      version: schemaVersion,
      onConfigure: (db) async {
        // Off by default in SQLite, and the outbox's payload rows are meaningless
        // without their entry.
        await db.execute('PRAGMA foreign_keys = ON');
      },
      onCreate: (db, version) async => _create(db),
      onUpgrade: (db, from, to) async => _upgrade(db, from, to),
    );
    return AppDatabase._(db);
  }

  /// An in-memory database, for tests and for a build with no filesystem.
  static Future<AppDatabase> inMemory() async {
    final db = await openDatabase(
      inMemoryDatabasePath,
      version: schemaVersion,
      onConfigure: (db) async => db.execute('PRAGMA foreign_keys = ON'),
      onCreate: (db, version) async => _create(db),
      onUpgrade: (db, from, to) async => _upgrade(db, from, to),
    );
    return AppDatabase._(db);
  }

  static Future<void> _create(Database db) async {
    // The outgoing queue. One row is one message the user has composed and the
    // server has not yet acknowledged.
    //
    // `client_message_id` is the PRIMARY KEY, not a surrogate: it is generated
    // once at compose time, reused on every retry, and is the idempotency key
    // the server deduplicates on. Making it the key means the database itself
    // refuses to hold the same message twice, so a double-tapped send or a
    // replayed restore cannot become two messages even if the code above it
    // has a bug.
    await db.execute('''
      CREATE TABLE outbox_message (
        client_message_id  TEXT PRIMARY KEY NOT NULL,
        conversation_id    TEXT NOT NULL,
        status             TEXT NOT NULL,
        attempts           INTEGER NOT NULL DEFAULT 0,
        enqueued_at        INTEGER NOT NULL,
        next_attempt_at    INTEGER,
        last_failure_code  TEXT,
        kind               TEXT NOT NULL,
        body               TEXT NOT NULL DEFAULT '',
        reply_to_message_id TEXT,
        -- JSON array of attachment metadata. A REFERENCE to bytes already in
        -- object storage, never the bytes: the upload completes before the
        -- message is queued, so this is a few hundred bytes the queue can
        -- actually keep rather than a video it cannot.
        attachments        TEXT NOT NULL DEFAULT '',
        updated_at         INTEGER NOT NULL
      )
    ''');

    // The drain asks "what is ready in this conversation, oldest first" and
    // "what is ready anywhere". Both are served by this.
    await db.execute(
      'CREATE INDEX outbox_ready_idx ON outbox_message (conversation_id, enqueued_at)',
    );
  }

  static Future<void> _upgrade(Database db, int from, int to) async {
    // One step at a time, so a device that skipped three releases takes the
    // same path as one that took them in order.
    for (var version = from + 1; version <= to; version += 1) {
      switch (version) {
        case 1:
          await _create(db);
        case 2:
          // Attachments became metadata rather than a list of ids. An existing
          // install has queued messages in this table, so the column is ADDED
          // rather than the table rebuilt — dropping it would discard somebody's
          // unsent words to add a column they were not using.
          await db.execute(
            "ALTER TABLE outbox_message ADD COLUMN attachments TEXT NOT NULL DEFAULT ''",
          );
        default:
          throw StateError('no migration to local schema version $version');
      }
    }
  }

  /// Drops everything that must not outlive a session.
  ///
  /// Wired to `clearLocalDataProvider`, which the auth controller calls on
  /// logout: queued messages belong to the person who composed them, and
  /// leaving them for the next person to sign in on the same device would send
  /// one account's words from another's.
  Future<void> clear() async {
    await db.delete('outbox_message');
  }

  Future<void> close() => db.close();
}
