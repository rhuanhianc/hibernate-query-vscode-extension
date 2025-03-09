package com.querytester;

import org.reflections.Reflections;
import org.reflections.util.ConfigurationBuilder;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.persistence.Entity;
import java.io.File;
import java.net.URL;
import java.net.URLClassLoader;
import java.util.HashSet;
import java.util.Set;

public class EntityScanner {
    private static final Logger LOG = LoggerFactory.getLogger(EntityScanner.class);
    private static URLClassLoader entityClassLoader;

    public static Set<Class<?>> scanEntities(String entityLibPath, String[] entityPackages) {
        Set<Class<?>> entities = new HashSet<>();
        try {
            URL[] urls;
            ClassLoader classLoader;
            
            if (entityLibPath != null && !entityLibPath.isEmpty()) {
                File jarFile = new File(entityLibPath);
                if (!jarFile.exists()) {
                    LOG.error("JAR not found: {}", entityLibPath);
                    return entities;
                }
                urls = new URL[]{jarFile.toURI().toURL()};
                
                // Store the ClassLoader in a static variable so it can be accessed later
                entityClassLoader = new URLClassLoader(urls, Thread.currentThread().getContextClassLoader());
                classLoader = entityClassLoader;
                
                // Set the ClassLoader in the current thread so Hibernate can use it
                Thread.currentThread().setContextClassLoader(entityClassLoader);
                
                LOG.info("Scanning entities from JAR: {}", entityLibPath);
            } else {
                classLoader = Thread.currentThread().getContextClassLoader();
                
                // If in the classpath, make sure you are using a URLClassLoader
                if (classLoader instanceof URLClassLoader) {
                    urls = ((URLClassLoader) classLoader).getURLs();
                } else {
                    LOG.warn("ClassLoader is not URLClassLoader, there may be class loading issues");
                    urls = new URL[0];
                }
                
                LOG.info("Scanning entities in the system classpath");
            }

            ConfigurationBuilder config = new ConfigurationBuilder()
                .setUrls(urls)
                .setClassLoaders(new ClassLoader[]{classLoader});

            if (entityPackages != null && entityPackages.length > 0) {
                LOG.info("Scanning specific packages: {}", (Object) entityPackages);
                
                for (String packageName : entityPackages) {
                    LOG.info("Starting scan of package: {}", packageName);
                    
                    Reflections reflections = new Reflections(config.forPackages(packageName));
                    Set<Class<?>> packageEntities = reflections.getTypesAnnotatedWith(Entity.class);
                    
                    LOG.info("Found {} entities in package {}", packageEntities.size(), packageName);
                    
                    for (Class<?> entity : packageEntities) {
                        String entityPackage = entity.getPackage().getName();
                        if (entityPackage.startsWith(packageName)) {
                            entities.add(entity);
                            LOG.debug("Added entity: {}", entity.getName());
                        }
                    }
                }
            } else {
                LOG.info("No package specified, scanning all available entities");
                Reflections reflections = new Reflections(config);
                Set<Class<?>> allEntities = reflections.getTypesAnnotatedWith(Entity.class);
                entities.addAll(allEntities);
                LOG.info("Found {} entities in all packages", allEntities.size());
            }
            
            LOG.info("Total entities found: {}", entities.size());
            return entities;
        } catch (Exception e) {
            LOG.error("Error scanning entities: {}", e.getMessage(), e);
            return entities;
        }
    }
    
    // Add a method to get the ClassLoader of the entities
    public static ClassLoader getEntityClassLoader() {
        return entityClassLoader != null ? entityClassLoader : Thread.currentThread().getContextClassLoader();
    }
}