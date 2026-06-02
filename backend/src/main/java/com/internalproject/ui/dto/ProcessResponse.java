package com.internalproject.ui.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.Map;

@JsonInclude(JsonInclude.Include.NON_NULL)
public class ProcessResponse {
    private final boolean ok;
    private Map<String, Object> result;
    private String error;

    public ProcessResponse(boolean ok, Map<String, Object> result) {
        this.ok = ok;
        this.result = result;
    }

    public ProcessResponse(boolean ok, String error) {
        this.ok = ok;
        this.error = error;
    }

    public boolean isOk() {
        return ok;
    }

    public Map<String, Object> getResult() {
        return result;
    }

    public String getError() {
        return error;
    }
}
