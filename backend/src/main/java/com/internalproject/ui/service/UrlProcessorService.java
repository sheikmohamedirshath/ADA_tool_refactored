package com.internalproject.ui.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * Processes a URL by running the ADA check. Supports:
 * 1. Java (Maven): set ada.java.project.root or ADA_JAVA_PROJECT_ROOT to the project that contains
 *    ADACheckModules/GenericURLADACheck. Runs: mvn test -Dtest=GenericURLADACheck -Dada.url=&lt;url&gt;
 *    then reads ADACheckResults/ADAOutput.json and returns it as axeResult.
 * 2. Otherwise: returns a placeholder (no axe result); you can run the Python backend for sample/Python runner.
 */
@Service
public class UrlProcessorService {

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();
    private static final int MAVEN_TIMEOUT_SECONDS = 300;

    @Value("${ada.java.project.root:}")
    private String adaJavaProjectRoot;

    public Map<String, Object> processUrl(String url) throws IOException, InterruptedException {
        String root = adaJavaProjectRoot != null && !adaJavaProjectRoot.isBlank()
                ? adaJavaProjectRoot
                : System.getenv("ADA_JAVA_PROJECT_ROOT");
        // Fallback: when running from backend/, use parent dir (project root) so Process always tries Java ADA check
        if (root == null || root.isBlank()) {
            root = Path.of(System.getProperty("user.dir")).getParent().toAbsolutePath().normalize().toString();
        }

        Path projectRoot = Path.of(root);
        Path absoluteRoot = projectRoot.isAbsolute()
                ? projectRoot
                : Path.of(System.getProperty("user.dir")).resolve(projectRoot).normalize().toAbsolutePath();
        return runJavaAdaCheck(absoluteRoot, url);
    }

    private Map<String, Object> runJavaAdaCheck(Path projectRoot, String url) throws IOException, InterruptedException {
        ProcessBuilder pb = new ProcessBuilder(
                "mvn", "test",
                "-Dtest=GenericURLADACheck",
                "-Dada.url=" + url
        );
        pb.directory(projectRoot.toFile());
        pb.redirectErrorStream(true);
        Process process = pb.start();
        boolean finished = process.waitFor(MAVEN_TIMEOUT_SECONDS, TimeUnit.SECONDS);
        if (!finished) {
            process.destroyForcibly();
            throw new RuntimeException("Maven ADA check timed out after " + MAVEN_TIMEOUT_SECONDS + "s");
        }
        if (process.exitValue() != 0) {
            String out = new String(process.getInputStream().readAllBytes());
            throw new RuntimeException("Maven ADA check failed (exit " + process.exitValue() + "): " + out);
        }

        Path outputJson = projectRoot.resolve("ADACheckResults").resolve("ADAOutput.json");
        if (!Files.exists(outputJson)) {
            throw new RuntimeException("ADA check did not produce ADACheckResults/ADAOutput.json");
        }

        Map<String, Object> axeResult = OBJECT_MAPPER.readValue(
                outputJson.toFile(),
                new TypeReference<Map<String, Object>>() {}
        );

        return Map.of(
                "url", url,
                "message", "ADA check completed",
                "axeResult", axeResult
        );
    }
}
