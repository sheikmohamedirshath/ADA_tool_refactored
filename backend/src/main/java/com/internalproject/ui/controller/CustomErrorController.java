package com.internalproject.ui.controller;

import jakarta.servlet.RequestDispatcher;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.boot.web.servlet.error.ErrorController;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;

/**
 * Custom error page so 404 shows a clear message instead of the whitelabel page.
 * Common cause: dist/ not built — run "npm run build" from the project root.
 */
@Controller
public class CustomErrorController implements ErrorController {

    private static final String ERROR_PATH = "/error";

    @RequestMapping(value = ERROR_PATH, produces = MediaType.TEXT_HTML_VALUE)
    public ResponseEntity<String> errorHtml(HttpServletRequest request) {
        Object status = request.getAttribute(RequestDispatcher.ERROR_STATUS_CODE);
        int statusCode = status != null ? Integer.parseInt(status.toString()) : 500;
        String title = statusCode == 404 ? "Page not found" : "Error " + statusCode;
        String body = statusCode == 404
                ? """
                <p>If you're using the <strong>Java backend</strong>, build the frontend first:</p>
                <ol>
                  <li>Open a terminal in the <strong>project root</strong> (e.g. <code>UI_Design</code>).</li>
                  <li>Run: <code>npm install</code> then <code>npm run build</code>.</li>
                  <li>Restart the backend and open <a href="/">http://localhost:5001/</a> again.</li>
                </ol>
                <p>If you already built, check that the <code>dist</code> folder exists in the project root.</p>
                """
                : "<p>An unexpected error occurred.</p>";
        String html = """
            <!DOCTYPE html>
            <html>
            <head><meta charset="UTF-8"><title>%s</title></head>
            <body style="font-family: sans-serif; max-width: 600px; margin: 2rem auto; padding: 1rem;">
            <h1>%s</h1>
            %s
            </body>
            </html>
            """.formatted(title, title, body);
        return ResponseEntity.status(statusCode).body(html);
    }
}
