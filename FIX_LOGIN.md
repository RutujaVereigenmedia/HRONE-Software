# Fix demo login (`Invalid credentials`)

The updated seed script fixes the most common cause: it now updates existing demo user records and resets their password hashes instead of leaving old hashes untouched.

## Windows PowerShell steps

1. Make sure PostgreSQL is running and `hrms_db` exists.
2. Open PowerShell in the project's `server` directory.
3. Check `server/.env` and make sure `DATABASE_URL` points to the same database where you imported `database/schema.sql`.
4. Run:
   ```powershell
   npm install
   npm run seed
   npm run dev
   ```
5. In a second terminal, open `client` and run:
   ```powershell
   npm install
   npm run dev
   ```
6. Sign in with `superadmin@demo.local` / `ChangeMe123!`.

If seed fails, the terminal error is the key diagnostic. Common causes are a stopped PostgreSQL service, wrong database password, missing schema, or a `DATABASE_URL` that points to another database. Do not paste real database passwords into public chats.


## Applying monthly leave-credit changes

After extracting the updated ZIP, run the updated `database/schema.sql` against your existing `hrms_db` database. It adds the `credit_day` column safely and updates the default PL/CL amounts. Restart the API after the schema update. Monthly accrual runs on the 25th and also backfills eligible missing months at startup.
