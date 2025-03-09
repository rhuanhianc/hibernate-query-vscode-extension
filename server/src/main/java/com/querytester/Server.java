package com.querytester;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonDeserializer;
import com.querytester.dto.QueryResultDTO;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.net.ServerSocket;
import java.net.Socket;
import java.text.SimpleDateFormat;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class Server {
    private static final Logger LOG = LoggerFactory.getLogger(Server.class);
    private static int PORT = 8089; // Default port, can be changed via args
    private static final int MAX_THREADS = 10; // Maximum number of simultaneous threads
    private static final Gson GSON = new GsonBuilder()
        .registerTypeAdapter(Date.class, (JsonDeserializer<Date>) (json, type, context) -> {
            try {
                return new SimpleDateFormat("yyyy-MM-dd").parse(json.getAsString());
            } catch (Exception e) {
                LOG.error("Error parsing date: {}", json.getAsString());
                return null;
            }
        })
        .setLenient()
        .create();

    public static void main(String[] args) {
        // Allow port configuration via command line arguments
        if (args.length > 0) {
            try {
                PORT = Integer.parseInt(args[0]);
                LOG.info("Port configured via command line: {}", PORT);
            } catch (NumberFormatException e) {
                LOG.warn("Invalid port argument: {}. Using default port: {}", args[0], PORT);
            }
        }

        // Create thread pool for better performance
        ExecutorService threadPool = Executors.newFixedThreadPool(MAX_THREADS);
        
        try (ServerSocket serverSocket = new ServerSocket(PORT)) {
            LOG.info("Server started on port {}", PORT);
            LOG.info("Query Tester Server ready to receive connections");
            
            while (true) {
                try {
                    Socket clientSocket = serverSocket.accept();
                    LOG.debug("New connection received: {}", clientSocket.getInetAddress());
                    
                    // Process each connection in a separate thread from the pool
                    threadPool.execute(() -> handleClient(clientSocket));
                } catch (Exception e) {
                    LOG.error("Error accepting connection: {}", e.getMessage(), e);
                }
            }
        } catch (Exception e) {
            LOG.error("Error starting server: {}", e.getMessage(), e);
            threadPool.shutdown();
        }
    }

    private static void handleClient(Socket clientSocket) {
        try (PrintWriter out = new PrintWriter(clientSocket.getOutputStream(), true);
             BufferedReader in = new BufferedReader(new InputStreamReader(clientSocket.getInputStream()))) {
            
            String inputLine = in.readLine();
            if (inputLine != null) {
                LOG.debug("Request received: {}", inputLine);
                try {
                    Request request = GSON.fromJson(inputLine, Request.class);
                    QueryResultDTO response = handleRequest(request);
                    String jsonResponse = GSON.toJson(response);
                    LOG.debug("Response sent: {}", jsonResponse);
                    out.println(jsonResponse);
                } catch (Exception e) {
                    LOG.error("Error processing request: {}", e.getMessage(), e);
                    QueryResultDTO errorResponse = new QueryResultDTO();
                    errorResponse.setStatus("ERROR");
                    errorResponse.setMessage("Error processing request: " + e.getMessage());
                    out.println(GSON.toJson(errorResponse));
                }
            }
        } catch (Exception e) {
            LOG.error("Error in client communication: {}", e.getMessage(), e);
        } finally {
            try {
                clientSocket.close();
            } catch (Exception e) {
                LOG.error("Error closing socket: {}", e.getMessage());
            }
        }
    }

    private static QueryResultDTO handleRequest(Request request) {
        QueryResultDTO response = new QueryResultDTO();
        if (request == null || request.command == null || request.query == null) {
            response.setStatus("ERROR");
            response.setMessage("Invalid request: command or query missing");
            return response;
        }

        try {
            switch (request.command) {
                case "executeQuery":
                    // Initialize Hibernate with specified version and configurations
                    HibernateManager.initialize(
                        request.dbConfig, 
                        request.entityLibPath, 
                        request.entityPackages, 
                        request.projectScan, 
                        request.hibernateVersion
                    );
                    
                    // Define fields to include in response, if specified
                    Set<String> fieldsToInclude = request.fieldsToInclude != null 
                        ? new HashSet<>(Arrays.asList(request.fieldsToInclude)) 
                        : null;
                    
                    // Execute query based on isNative flag
                    if (request.isNative) {
                        LOG.info("Executing native SQL query: {}", request.query);
                        response = QueryExecutor.executeNativeSql(request.query, request.params);
                    } else {
                        LOG.info("Executing JPQL query: {}", request.query);
                        response = QueryExecutor.executeJpql(request.query, request.params, fieldsToInclude);
                    }
                    break;
                default:
                    response.setStatus("ERROR");
                    response.setMessage("Unknown command: " + request.command);
            }
        } catch (Exception e) {
            response.setStatus("ERROR");
            response.setMessage("Error executing command: " + e.getMessage());
            LOG.error("Error executing command {}: {}", request.command, e.getMessage(), e);
        }
        return response;
    }

    static class Request {
        String command;
        String query;
        Map<String, String> dbConfig;
        String entityLibPath;
        String[] entityPackages;
        boolean projectScan;
        String hibernateVersion;
        Map<String, Object> params;
        String[] fieldsToInclude;
        boolean isNative; // Flag to indicate if it's a native query (SQL) or JPQL
    }
}