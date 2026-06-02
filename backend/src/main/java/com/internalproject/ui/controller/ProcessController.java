package com.internalproject.ui.controller;

import com.internalproject.ui.dto.ProcessRequest;
import com.internalproject.ui.dto.ProcessResponse;
import com.internalproject.ui.service.UrlProcessorService;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api")
public class ProcessController {

    private final UrlProcessorService urlProcessorService;

    public ProcessController(UrlProcessorService urlProcessorService) {
        this.urlProcessorService = urlProcessorService;
    }

    @PostMapping(value = "/process", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<?> process(@RequestBody ProcessRequest body) {
        String url = body != null && body.getUrl() != null ? body.getUrl().strip() : "";
        if (url.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Missing or empty 'url'"));
        }
        try {
            Map<String, Object> result = urlProcessorService.processUrl(url);
            return ResponseEntity.ok(new ProcessResponse(true, result));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(new ProcessResponse(false, e.getMessage()));
        }
    }
}
