# Release sample packages

This directory is the local staging area for the sample packages linked from the project README and manual. ZIP files are ignored by Git and published as assets of the release that produced them.

Published asset names for Vivlio 0.8.0:

- `vivlio-sample-akutagawa-0.8.0.zip`
  - SHA-256: `47c1434118d452e7d31c4a1f5f33c22ec6ba83f0a1f43a9acf45693697cd3bb1`
- `vivlio-sample-sherlock-holmes-0.8.0.zip`
  - SHA-256: `8682e0f4d9d18ded900ef714ac039fa8e9306f0fd759ecbb0829a10d65a273f9`

The source archives deliberately retain the top-level folder names `A5二段組` and `English Novel Sample`. Their `vivlio.yaml` files contain vault-relative paths beginning with those names. Repackage without renaming any existing entry, and use UTF-8 ZIP entry names.

The package-specific README source files in this directory are added to the corresponding outer ZIP before upload.
