# Local compatibility patch

Upstream imap-proto 0.10.2, MIT/Apache-2.0.

Allow an empty STATUS attribute list (`STATUS mailbox ()`). Tencent enterprise mail returns this when UIDVALIDITY is not available, including for nonempty folders. This permits the IMAP client to consume the tagged completion and keep the connection synchronized; the application then re-fetches and deduplicates full MIME content.

The protocol change is only in `status_att_list` in `src/parser/rfc3501.rs` changes from a nonempty list to an optionally empty list. No mail literals or transport checks are modified. Application protocol fixture tests cover empty attributes, subsequent FETCH, and repeated downloads.

The four macro forwarding arms in `src/macros.rs` also omit their trailing semicolons to compile under the current Rust compiler; parser behavior is unchanged.
