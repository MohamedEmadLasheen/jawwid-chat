/// Whether a URL already carries its own authentication.
///
/// ## Why this question has one answer in one place
///
/// Two storage backends sit behind the same client, and they want OPPOSITE
/// things from a request:
///
/// - An S3 presigned URL (MinIO included) carries the credential, the signature
///   and their scope in the query string. It IS the authentication, and S3
///   refuses a request that also carries an `Authorization` header --
///   "request has multiple authentication types, please use one".
/// - The local reference storage signs the OBJECT, in its own `expires`/`sig`
///   pair. Its route is `@Public()`, so the signature alone is the access
///   decision and a session header is neither required nor harmful there.
///
/// So the header must be sent to one and withheld from the other, and the URL
/// the server handed us is the only thing that says which. Getting it wrong is
/// invisible in one direction and fatal in the other -- a dropped header 401s
/// every reference-storage request, and an extra header 400s every presigned
/// one, which once showed up as an upload that hung and later as a profile
/// photo that silently never changed. One predicate, two call sites: the upload
/// PUT and the image GET cannot drift apart.
library;

/// True when [url] authenticates itself with SigV4 query parameters.
///
/// Decided by the PRESENCE OF THE PARAMETER NAMES, never by a host, a scheme, a
/// path prefix, a provider name or any configuration: those vary per deployment
/// and per bucket, while a signed URL is recognisable by what it carries.
///
/// Both the algorithm and the signature are required. The reference storage's
/// own URLs carry an unrelated `sig`/`expires` pair, and a looser test would
/// mistake those for SigV4 and strip the header they depend on.
///
/// Reads the RAW query and compares names case-insensitively: the names are
/// canonically `X-Amz-*`, but a URL is a poor place to depend on a signer's
/// casing, and never decoding means a malformed value cannot throw. No value is
/// read, returned or logged -- only whether two names are present.
bool urlAuthenticatesItself(String url) {
  final Uri parsed;
  try {
    parsed = Uri.parse(url);
  } on FormatException {
    // An unparseable URL is not a presigned one. Say so rather than deciding
    // the credential question on a guess; the request then fails on its own
    // terms, which is a far clearer signal than a missing header.
    return false;
  }

  final query = parsed.query;
  if (query.isEmpty) return false;

  var hasSignature = false;
  var hasAlgorithm = false;
  for (final pair in query.split('&')) {
    final separator = pair.indexOf('=');
    final name =
        (separator == -1 ? pair : pair.substring(0, separator)).toLowerCase();
    if (name == 'x-amz-signature') hasSignature = true;
    if (name == 'x-amz-algorithm') hasAlgorithm = true;
  }
  return hasSignature && hasAlgorithm;
}
