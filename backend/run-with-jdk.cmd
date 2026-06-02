@echo off
REM Use JDK 17 for this project if JAVA_HOME points to a JRE or is unset.
set "CANDIDATE="
if defined JAVA_HOME (
  if exist "%JAVA_HOME%\bin\javac.exe" (
    echo Using JAVA_HOME: %JAVA_HOME%
    goto :run
  )
)
for %%D in ("C:\Program Files\Java\jdk-17" "C:\Program Files\Java\jdk-22") do (
  if exist "%%~D\bin\javac.exe" (
    set "CANDIDATE=%%~D"
    goto :found
  )
)
if not defined CANDIDATE (
  echo No JDK found. Set JAVA_HOME to a JDK 17+ (e.g. "C:\Program Files\Java\jdk-17"^)
  exit /b 1
)
:found
set "JAVA_HOME=%CANDIDATE%"
echo Using JDK: %JAVA_HOME%
:run
cd /d "%~dp0"
call mvnw.cmd spring-boot:run
