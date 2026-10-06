# Local compatibility patch

Upstream imap-proto 0.10.2, MIT/Apache-2.0.

Allow an empty STATUS attribute list (`STATUS mailbox ()`). Tencent enterprise mail returns this when UIDVALIDITY is not available, including for nonempty folders. This permits the IMAP client to consume the tagged completion and keep the connection synchronized; the application then re-fetches and deduplicates full MIME content.

`status_att_list` in `src/parser/rfc3501.rs` changes from a nonempty list to an optionally empty list. No mail literals or transport checks are modified. Application protocol fixture tests cover empty attributes, subsequent FETCH, and repeated downloads.

Also tolerate trailing ASCII spaces in CAPABILITY lists. Tencent's post-login response ends with `UIDPLUS SP CRLF`, which otherwise prevents detection of IDLE and leaves the response unread. Only trailing spaces are accepted; the IMAP4rev1 requirement and tagged completion remain intact. The application loopback test uses the observed Tencent capability list and verifies that subsequent EXAMINE, IDLE and DONE commands complete correctly.

The four macro forwarding arms in `src/macros.rs` also omit their trailing semicolons to compile under the current Rust compiler; parser behavior is unchanged.

Accept NIL in the BODYSTRUCTURE transfer-encoding field. Tencent returns this for parts without a Content-Transfer-Encoding header; upstream requires a string and rejects the complete FETCH before reading its header literal. Map this absent value to SevenBit (MIME's default identity encoding, RFC 2045 section 6.1). Quoted encodings, literal byte lengths and truncated response rejection stay unchanged. Application regression tests use a sanitized multipart alternative matching the observed structure and verify headers, attachment detection, and a following response.

QQ's observed UID 1339 BODYSTRUCTURE contains a non-UTF8 `filename` value in the attachment disposition. The upstream borrowed string API rejects the entire FETCH. Accept only invalid UTF8 parameter values for `name`/`filename`, preserving the key with an empty (unavailable) value in the structural metadata. The original response bytes, MIME, attachment content and filenames parsed from full MIME remain intact; no charset is guessed and no bytes are stripped. Other parameter values remain UTF8-validated, and quoted/literal framing remains strict. Application tests cover legacy filenames, valid UTF8 names, attachment recognition, raw header preservation, subsequent tagged completion, truncated strings/literals and rejection of invalid boundary/encoding values.

## 2026-10-06 compiler compatibility

A local `do_parse!` macro in `src/sequence_compat.rs` retains nom 5.1.3's
implementation but removes expression-position trailing semicolons. Its standard
library paths refer directly to `std` because this crate enables nom's std
feature. The original nom MIT license is included as `NOM_LICENSE`.

This avoids the newer Rust non-local macro future-compatibility warning without
allowing or disabling the lint. Explicit borrowed lifetimes were added to return
types, and the unused PrivateShared payload was removed without changing parser
stages. Run both imap-proto's own tests and the application's protocol regressions.
