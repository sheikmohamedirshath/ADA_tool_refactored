# MSSQL setup and querying for ADA Tool scan history

**Database and table are created automatically.** When you set `MSSQL_CONN_STR` and start the app, it will create the database (e.g. `ADA_DB`) and the `ScanHistory` table if they do not exist. No manual SQL scripts are required—on Azure, AWS, or your laptop, just provide the connection string.

This guide covers installing SQL Server (or connecting to an existing one), configuring the ODBC driver and connection string, and querying the `ScanHistory` table.

---

## 1. Have SQL Server available

You need a SQL Server instance. Choose one:

### Option A: SQL Server on Windows (already installed)

- If **SQL Server** or **SQL Server Express** is already installed, note:
  - **Server name:** often `localhost`, `.\SQLEXPRESS`, or `(local)\SQLEXPRESS`
  - **Port:** default `1433` (Express sometimes uses a dynamic port; check SQL Server Configuration Manager)
- Create a database (see step 3) and a login (e.g. SQL auth user + password).

### Option B: Install SQL Server Express (Windows)

1. Download: [SQL Server Express](https://www.microsoft.com/en-us/sql-server/sql-server-downloads) → Express.
2. Run the installer; choose **Basic** or **Custom**.
3. After install, note the **Server name** (e.g. `localhost\SQLEXPRESS`).
4. (Optional) Install **SQL Server Management Studio (SSMS)** from the same download page for a GUI.

### Option C: SQL Server in Docker

```bash
docker run -e "ACCEPT_EULA=Y" -e "MSSQL_SA_PASSWORD=YourStrong!Pass123" \
  -p 1433:1433 --name sql1 \
  -d mcr.microsoft.com/mssql/server:2022-latest
```

- Server: `localhost,1433`
- User: `ada_user`
- Password: `YourStrong!Pass123`

### Option D: Azure SQL Database

- Create a logical server and database in Azure Portal.
- Note: **Server** (e.g. `yourserver.database.windows.net`), **Database**, **User**, **Password**.
- Ensure your IP is allowed in the server firewall.

---

## 2. Install ODBC Driver for SQL Server

The app uses **ODBC** to talk to SQL Server. You need the Microsoft driver on the machine where `python app.py` runs.

### Windows

1. Download: [Microsoft ODBC Driver 18 for SQL Server](https://learn.microsoft.com/en-us/sql/connect/odbc/download-odbc-driver-for-sql-server).
2. Run the installer (`msodbcsql_18_*.exe`).
3. Verify: open **ODBC Data Sources (64-bit)** (search in Start) → **Drivers** tab → you should see **ODBC Driver 18 for SQL Server**.

### WSL / Linux (e.g. Ubuntu)

**Option 1: Use the Ubuntu 22.04 repo (recommended, including on Ubuntu 24.04)**

Microsoft does not publish `msodbcsql18` for all Ubuntu versions. Using the **22.04** repo works on both Ubuntu 22.04 and 24.04:

```bash
# 1. Add Microsoft’s GPG key
curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | sudo gpg --dearmor -o /usr/share/keyrings/microsoft-prod.gpg

# 2. Add repo — use "jammy" (Ubuntu 22.04) so the package is found (works on 24.04 too)
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/microsoft-prod.gpg] https://packages.microsoft.com/ubuntu/22.04/prod jammy main" | sudo tee /etc/apt/sources.list.d/mssql-release.list

# 3. Update and install
sudo apt-get update
sudo ACCEPT_EULA=Y apt-get install -y msodbcsql18

# Optional: command-line tools (sqlcmd, bcp)
sudo ACCEPT_EULA=Y apt-get install -y mssql-tools18
echo 'export PATH="$PATH:/opt/mssql-tools18/bin"' >> ~/.bashrc
source ~/.bashrc
```

**If you still get “Unable to locate package msodbcsql18”**

- **On Ubuntu 24.04:** the 22.04 repo uses codename `jammy`. Add the list file manually:

  ```bash
  echo "deb [arch=amd64 signed-by=/usr/share/keyrings/microsoft-prod.gpg] https://packages.microsoft.com/ubuntu/22.04/prod jammy main" | sudo tee /etc/apt/sources.list.d/mssql-release.list
  sudo apt-get update
  sudo ACCEPT_EULA=Y apt-get install -y msodbcsql18
  ```

- **Or install the .deb by hand:**  
  Download **ODBC Driver 18 for SQL Server** for Ubuntu 22.04 from [Microsoft’s download page](https://learn.microsoft.com/en-us/sql/connect/odbc/download-odbc-driver-for-sql-server), then:

  ```bash
  sudo apt-get install -y unixodbc
  sudo dpkg -i msodbcsql18_18.*_amd64.deb
  # If dpkg reports missing deps: sudo apt-get install -f
  ```

Verify:

```bash
odbcinst -q -d
# Should list "ODBC Driver 18 for SQL Server"
```

---

## 3. Database and table (automatic)

You do **not** need to create the database or table manually. When the app starts with `MSSQL_CONN_STR` set, it will create the database (default `ADA_DB`) and the `dbo.ScanHistory` table if they do not exist. Your connection string can include `Database=ADA_DB` or omit it. Optional env: `MSSQL_DATABASE=YourDbName`.

*(Optional)* To create them yourself, connect to your SQL Server (SSMS, Azure Data Studio, or `sqlcmd`) and run:

```sql
-- Create database (if you don’t have one yet)
CREATE DATABASE ADA_DB;
GO

USE ADA_DB;
GO

-- Table for scan history (same as in the app)
CREATE TABLE dbo.ScanHistory (
    Id            INT IDENTITY(1,1) PRIMARY KEY,
    Url           NVARCHAR(2048) NOT NULL,
    TimestampUtc  DATETIME2(3)   NOT NULL,
    Passes        INT            NOT NULL,
    Violations    INT            NOT NULL,
    PassRate      INT            NOT NULL,
    UsedFallback  BIT            NOT NULL
);
GO
```

If you use **SQL Server auth**, create a login and user:

```sql
CREATE LOGIN ada_user WITH PASSWORD = 'YourStrong!Pass';
GO

USE ADA_DB;
GO

CREATE USER ada_user FOR LOGIN ada_user;
ALTER ROLE db_datareader ADD MEMBER ada_user;
ALTER ROLE db_datawriter ADD MEMBER ada_user;
GO
```

---

## 4. Set the connection string (MSSQL_CONN_STR)

Format:

```
Driver={ODBC Driver 18 for SQL Server};Server=<server>;Database=<database>;Uid=ada_user;Pwd=AdaTool@123;Encrypt=yes;TrustServerCertificate=yes;
```

- **Encrypt=yes;TrustServerCertificate=yes** — typical for local / self-signed (remove TrustServerCertificate for production Azure with proper certs).
- **Server** can include a port: `Server=localhost,1433` or `Server=.\SQLEXPRESS`.

### Examples

**Windows – default instance, SQL auth**

```powershell
$env:MSSQL_CONN_STR = "Driver={ODBC Driver 18 for SQL Server};Server=localhost;Database=ADA_DB;Uid=ada_user;Pwd=YourStrong!Pass;Encrypt=yes;TrustServerCertificate=yes;"
python app.py
```

**Windows – named instance (Express)**

```powershell
$env:MSSQL_CONN_STR = "Driver={ODBC Driver 18 for SQL Server};Server=localhost\SQLEXPRESS;Database=ADA_DB;Uid=ada_user;Pwd=AdaTool@123;Encrypt=yes;TrustServerCertificate=yes;"
```

**WSL / Linux**

```bash
export MSSQL_CONN_STR='Driver={ODBC Driver 18 for SQL Server};Server=localhost,1433;Database=ADA_DB;Uid=ada_user;Pwd=AdaTool@123;Encrypt=yes;TrustServerCertificate=yes;'
python app.py
```

**Azure SQL**

```bash
export MSSQL_CONN_STR='Driver={ODBC Driver 18 for SQL Server};Server=yourserver.database.windows.net;Database=ADA_DB;Uid=youradmin;Pwd=YourPassword;Encrypt=yes;'
```

### Optional: `.env` file

To avoid typing the string each time:

1. Create a file `.env` in the project root (do **not** commit it; add `.env` to `.gitignore`).
2. Put one line:
   ```env
   MSSQL_CONN_STR=Driver={ODBC Driver 18 for SQL Server};Server=localhost;Database=ADA_DB;Uid=ada_user;Pwd=YourStrong!Pass;Encrypt=yes;TrustServerCertificate=yes;
   ```
3. Load it before running the app, e.g.:
   ```bash
   set -a && source .env && set +a && python app.py
   ```
   Or use a package like `python-dotenv` in `app.py` to load `.env` automatically.

---

## 5. How to query ScanHistory

Once the app is writing to `dbo.ScanHistory`, you can query it with any SQL client (SSMS, Azure Data Studio, `sqlcmd`, etc.).

### Basic SELECT

```sql
USE ADA_DB;
GO

-- All rows, newest first
SELECT Id, Url, TimestampUtc, Passes, Violations, PassRate, UsedFallback
FROM dbo.ScanHistory
ORDER BY TimestampUtc DESC;

-- Last 20 scans
SELECT TOP (20) Id, Url, TimestampUtc, Passes, Violations, PassRate, UsedFallback
FROM dbo.ScanHistory
ORDER BY TimestampUtc DESC;
```

### Filter and search

```sql
-- By URL (contains)
SELECT * FROM dbo.ScanHistory
WHERE Url LIKE N'%example.com%'
ORDER BY TimestampUtc DESC;

-- Scans with violations
SELECT * FROM dbo.ScanHistory
WHERE Violations > 0
ORDER BY Violations DESC, TimestampUtc DESC;

-- Fallback runs only
SELECT * FROM dbo.ScanHistory
WHERE UsedFallback = 1
ORDER BY TimestampUtc DESC;

-- Date range (UTC)
SELECT * FROM dbo.ScanHistory
WHERE TimestampUtc >= '2025-01-01' AND TimestampUtc < '2026-01-01'
ORDER BY TimestampUtc DESC;
```

### Aggregates and reporting

```sql
-- Count per URL
SELECT Url, COUNT(*) AS ScanCount, MAX(TimestampUtc) AS LastScan
FROM dbo.ScanHistory
GROUP BY Url
ORDER BY ScanCount DESC;

-- Average pass rate per URL
SELECT Url, COUNT(*) AS Scans, AVG(PassRate) AS AvgPassRate, AVG(Violations) AS AvgViolations
FROM dbo.ScanHistory
GROUP BY Url
ORDER BY AvgPassRate ASC;

-- Worst pass rate (single scan)
SELECT TOP (10) Id, Url, TimestampUtc, PassRate, Violations
FROM dbo.ScanHistory
ORDER BY PassRate ASC, Violations DESC;
```

### Export to CSV (from SSMS or Azure Data Studio)

Run a `SELECT`, then in the results grid use **Save Results As…** and choose CSV.

### Query from Python (optional)

```python
import os
import pyodbc

conn_str = os.environ["MSSQL_CONN_STR"]
conn = pyodbc.connect(conn_str)

cursor = conn.cursor()
cursor.execute("""
    SELECT Id, Url, TimestampUtc, Passes, Violations, PassRate, UsedFallback
    FROM dbo.ScanHistory
    ORDER BY TimestampUtc DESC
""")
for row in cursor.fetchall():
    print(row)

conn.close()
```

---

## 6. Troubleshooting

| Issue | What to try |
|-------|-------------|
| **"MSSQL_CONN_STR environment variable is not set"** | Set `MSSQL_CONN_STR` in the same shell where you run `python app.py` (or load it from `.env`). |
| **"Driver not found"** | Install ODBC Driver 18 (step 2). On Windows use 64-bit driver if Python is 64-bit. |
| **Login failed / timeout** | Check Server name, port, firewall; confirm Uid/Pwd and that the user has access to the database. |
| **Encryption/SSL** | For local dev, keep `TrustServerCertificate=yes`. For Azure, often `Encrypt=yes` only. |
| **Named instance** | Use `Server=hostname\INSTANCENAME` (e.g. `.\SQLEXPRESS`). |

---

## Quick reference

- **Create DB + table:** run the `CREATE DATABASE` and `CREATE TABLE` from step 3.
- **Run the app:** set `MSSQL_CONN_STR`, then `python app.py`; each successful scan inserts one row.
- **Query:** connect to the same database and use the `SELECT` examples in step 5.
