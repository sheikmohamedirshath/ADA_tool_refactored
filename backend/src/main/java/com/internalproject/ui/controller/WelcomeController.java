package com.internalproject.ui.controller;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * Serves the React app's index.html for GET / so the root URL always works.
 * Uses app.dist.path if set, otherwise tries parent/dist or dist/ relative to user.dir.
 */
@Controller
public class WelcomeController {

    @Value("${app.dist.path:}")
    private String distPathOverride;

    private Path findDistIndex() {
        if (distPathOverride != null && !distPathOverride.isBlank()) {
            Path p = Paths.get(distPathOverride.replace('\\', '/')).resolve("index.html").normalize();
            if (Files.isRegularFile(p)) {
                return p;
            }
        }
        String cwd = System.getProperty("user.dir");
        Path fromParent = Paths.get(cwd).resolve("..").resolve("dist").resolve("index.html").normalize().toAbsolutePath();
        if (Files.isRegularFile(fromParent)) {
            return fromParent;
        }
        Path fromCwd = Paths.get(cwd).resolve("dist").resolve("index.html").normalize().toAbsolutePath();
        if (Files.isRegularFile(fromCwd)) {
            return fromCwd;
        }
        return null;
    }

    @GetMapping("/")
    public ResponseEntity<Resource> index() {
        Path indexFile = findDistIndex();
        if (indexFile == null) {
            return ResponseEntity.notFound().build();
        }
        Resource resource = new FileSystemResource(indexFile);
        return ResponseEntity.ok()
                .contentType(MediaType.TEXT_HTML)
                .header(HttpHeaders.CACHE_CONTROL, "no-cache")
                .body(resource);
    }
}
