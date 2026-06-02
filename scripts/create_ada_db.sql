-- ============================================================
-- ADA Tool: create database and ScanHistory table
-- Run this in SQL Server Management Studio (SSMS) or Azure Data Studio
-- Connect to your local instance (e.g. localhost or .\SQLEXPRESS)
-- ============================================================

-- 1. Create the database
IF NOT EXISTS (SELECT * FROM sys.databases WHERE name = N'ADA_DB')
BEGIN
    CREATE DATABASE ADA_DB;
    PRINT 'Database ADA_DB created.';
END
ELSE
    PRINT 'Database ADA_DB already exists.';
GO

USE ADA_DB;
GO

-- 2. Create the ScanHistory table (used by the Flask app)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = N'ScanHistory')
BEGIN
    CREATE TABLE dbo.ScanHistory (
        Id            INT IDENTITY(1,1) PRIMARY KEY,
        Url           NVARCHAR(2048) NOT NULL,
        TimestampUtc  DATETIME2(3)   NOT NULL,
        Passes        INT            NOT NULL,
        Violations    INT            NOT NULL,
        PassRate      INT            NOT NULL,
        UsedFallback  BIT            NOT NULL
    );
    PRINT 'Table dbo.ScanHistory created.';
END
ELSE
    PRINT 'Table dbo.ScanHistory already exists.';
GO

-- 3. (Optional) Create a SQL Server login and user for the app
--    Skip this if you will use Windows auth or the 'sa' account.
--    Uncomment and set a strong password:

/*
CREATE LOGIN ada_user WITH PASSWORD = 'YourStrong!Pass123';
GO

USE ADA_DB;
GO

CREATE USER ada_user FOR LOGIN ada_user;
ALTER ROLE db_datareader ADD MEMBER ada_user;
ALTER ROLE db_datawriter ADD MEMBER ada_user;
PRINT 'Login and user ada_user created.';
GO
*/
