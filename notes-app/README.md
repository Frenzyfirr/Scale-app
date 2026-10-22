# Margin Notes (Android, offline)

Plain-text notes stored as .txt files in the app's private folder. No internet permission.
Search words and "exact phrases" (accents and capitals ignored), merge notes, export to TXT, PDF, Word (.docx) and CSV,
lock single notes or the whole app with a password (AES-256-GCM, key from PBKDF2-SHA-256, 600 000 iterations),
encrypted exports and backups, trash with 30-day recovery.

The page source is in `src/`; `./build-page.sh` assembles it into `app/src/main/assets/index.html`.
PDF export embeds a subset of Liberation Sans (SIL Open Font License 1.1), renamed Margin Sans.
