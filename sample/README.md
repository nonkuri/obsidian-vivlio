# Release sample packages

This directory is the local staging area for the sample packages linked from the project README and manual. ZIP files are ignored by Git and published as assets of the release that produced them.

Published asset names:

- `vivlio-sample-akutagawa-0.10.1.zip`
  - SHA-256: `a582e330fcb77b5cde8ed4037408b2dde27084bf051800eed7e9fb055003ca68`
- `vivlio-sample-sherlock-holmes-0.8.0.zip`
  - SHA-256: `8682e0f4d9d18ded900ef714ac039fa8e9306f0fd759ecbb0829a10d65a273f9`

The source archives deliberately retain the top-level folder names `A5二段組` and `English Novel Sample`. Their `vivlio.yaml` files contain vault-relative paths beginning with those names. Repackage without renaming any existing entry, and use UTF-8 ZIP entry names.

The package-specific README source files in this directory are added to the corresponding outer ZIP before upload.
