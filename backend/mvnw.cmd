@REM Maven Wrapper - runs Maven without "mvn" on PATH. Downloads wrapper jar on first run.
@echo off
setlocal EnableDelayedExpansion
set "MAVEN_PROJECTBASEDIR=%~dp0"
cd /d "%MAVEN_PROJECTBASEDIR%"

set "WRAPPER_JAR=%MAVEN_PROJECTBASEDIR%.mvn\wrapper\maven-wrapper.jar"
set "WRAPPER_PROP=%MAVEN_PROJECTBASEDIR%.mvn\wrapper\maven-wrapper.properties"

if not exist "%WRAPPER_PROP%" (
  echo Error: .mvn\wrapper\maven-wrapper.properties not found.
  exit /b 1
)

if not exist "%WRAPPER_JAR%" (
  echo Downloading Maven Wrapper...
  set "WRAPPER_URL=https://repo.maven.apache.org/maven2/org/apache/maven/wrapper/maven-wrapper/3.2.0/maven-wrapper-3.2.0.jar"
  where curl >nul 2>&1
  if !ERRORLEVEL! equ 0 (
    curl -sL -o "!WRAPPER_JAR!" "!WRAPPER_URL!"
  ) else (
    pushd "%MAVEN_PROJECTBASEDIR%.mvn\wrapper"
    certutil -urlcache -split -f "!WRAPPER_URL!" >nul 2>&1
    if exist maven-wrapper-3.2.0.jar move /y maven-wrapper-3.2.0.jar maven-wrapper.jar
    popd
  )
  if not exist "%WRAPPER_JAR%" (
    echo Failed to download. Install Maven from https://maven.apache.org/download.cgi
    exit /b 1
  )
)

if "%JAVA_HOME%"=="" (
  echo Error: JAVA_HOME is not set. Set it to your JDK installation.
  exit /b 1
)
if not exist "%JAVA_HOME%\bin\java.exe" (
  echo Error: JAVA_HOME is not set to a valid JDK: %JAVA_HOME%
  exit /b 1
)

set "MAVEN_DIR=%MAVEN_PROJECTBASEDIR:~0,-1%"
"%JAVA_HOME%\bin\java.exe" -classpath "%WRAPPER_JAR%" "-Dmaven.multiModuleProjectDirectory=%MAVEN_DIR%" org.apache.maven.wrapper.MavenWrapperMain %*
exit /b %ERRORLEVEL%
