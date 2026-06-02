package com.internalproject.ui.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.Resource;
import org.springframework.core.Ordered;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import org.springframework.web.servlet.resource.PathResourceResolver;

import java.io.IOException;
import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * Serves the built React app from app.dist.path or ../dist.
 * Falls back to index.html for SPA routes.
 */
@Configuration
public class WebConfig implements WebMvcConfigurer {

    @Value("${app.dist.path:}")
    private String distPathOverride;

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        Path distPath;
        if (distPathOverride != null && !distPathOverride.isBlank()) {
            distPath = Paths.get(distPathOverride.replace('\\', '/')).toAbsolutePath().normalize();
        } else {
            distPath = Paths.get("..").resolve("dist").toAbsolutePath().normalize();
        }
        String location = "file:" + distPath.toString().replace('\\', '/') + "/";

        registry.addResourceHandler("/**")
                .addResourceLocations(location)
                .resourceChain(true)
                .setOrder(Ordered.LOWEST_PRECEDENCE)
                .addResolver(new PathResourceResolver() {
                    @Override
                    protected Resource getResource(String resourcePath, Resource location) throws IOException {
                        // Root or empty path -> serve index.html
                        if (resourcePath == null || resourcePath.isBlank() || "/".equals(resourcePath)) {
                            Resource index = location.createRelative("index.html");
                            if (index.exists()) {
                                return index;
                            }
                            return null;
                        }
                        Resource resource = location.createRelative(resourcePath);
                        if (resource.exists() && resource.isReadable()) {
                            return resource;
                        }
                        // SPA fallback: serve index.html for non-API routes (client-side routing)
                        if (!resourcePath.startsWith("api/")) {
                            Resource index = location.createRelative("index.html");
                            if (index.exists()) {
                                return index;
                            }
                        }
                        return null;
                    }
                });
    }
}
