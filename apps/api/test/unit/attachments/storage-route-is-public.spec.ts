import { Reflector } from '@nestjs/core';
import { StorageController } from '@communication/api/storage.controller';
import { PUBLIC_ROUTE } from '@platform/auth/auth.guard';

/**
 * The signed-URL route must be reachable WITHOUT a bearer token.
 *
 * ## The defect this closes
 *
 * `storage.controller.ts` has always documented itself as "unauthenticated by design",
 * because the HMAC signature in the URL *is* the authorization decision -- taken earlier, by
 * a service that had the actor in hand. But `AuthenticatedGuard` is registered globally and
 * protects every route unless it opts out with `@Public()`, and this controller never did.
 *
 * So the route answered 401 to everything, before any signature was examined. With the local
 * reference storage that meant an upload PUT stored nothing and a read GET served nothing:
 * no attachment, voice note, story image or avatar could be fetched at all. The comment said
 * one thing and the wiring did another, and a comment cannot fail a build.
 *
 * ## Why this is not a weakening
 *
 * A bearer token could never be the control here. These URLs are given to clients that do
 * not send tokens -- an `<img>`, Flutter's `Image.network` -- which is precisely why the
 * authorization is carried in the URL. And the guard was not protecting the object even when
 * it rejected: it proves only that somebody is signed in and inspects nothing about the key,
 * so any authenticated actor's token satisfied it. What protects an object is the signature:
 * bound to the key and an expiry, compared in constant time, and refused when stale.
 *
 * The companion test file asserts that the signed URL addresses a path this API serves;
 * together they are the two halves of "a minted URL actually works".
 */
describe('the local signed-URL route', () => {
  const reflector = new Reflector();

  it('is marked @Public(), because the signature is the authorization', () => {
    const isPublic = reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      StorageController.prototype.download,
      StorageController,
    ]);

    expect(isPublic).toBe(true);
  });

  it('is public for the UPLOAD half as well, not only the download', () => {
    // The PUT is handed to the client the same way, and a grant that cannot be spent is the
    // same outage as a photo that cannot be read.
    const isPublic = reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      StorageController.prototype.upload,
      StorageController,
    ]);

    expect(isPublic).toBe(true);
  });

  it('claims it in the one way the guard actually reads', () => {
    // Asserted at the class, which is where the decorator is applied -- so moving it to the
    // methods, or losing it in a refactor, fails here rather than in production.
    expect(Reflect.getMetadata(PUBLIC_ROUTE, StorageController)).toBe(true);
  });
});
