package com.querytester;

import org.hibernate.SessionFactory;
import org.hibernate.boot.Metadata;
import org.hibernate.boot.MetadataSources;
import org.hibernate.boot.registry.StandardServiceRegistry;
import org.hibernate.boot.registry.StandardServiceRegistryBuilder;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.persistence.Entity;
import javax.persistence.Embeddable;
import javax.persistence.MappedSuperclass;
import java.io.File;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.locks.ReadWriteLock;
import java.util.concurrent.locks.ReentrantReadWriteLock;

public class HibernateManager {
    private static final Logger LOG = LoggerFactory.getLogger(HibernateManager.class);
    private static SessionFactory sessionFactory;
    private static String currentDialect;
    private static String currentHibernateVersion;
    
    // Locks for thread-safe access
    private static final ReadWriteLock sessionFactoryLock = new ReentrantReadWriteLock();

    /**
     * Initializes Hibernate with the provided configurations
     */
    public static void initialize(Map<String, String> dbConfig, String entityLibPath, String[] entityPackages, boolean projectScan, String hibernateVersion) {
        try {
            // Checks if the current configuration is the same as the previous one and returns if there are no changes
            if (sessionFactory != null && isSameConfiguration(dbConfig, hibernateVersion)) {
                LOG.info("Using existing SessionFactory (configuration did not change)");
                return;
            }
            
            LOG.info("Initializing Hibernate version {}", hibernateVersion);
            currentHibernateVersion = hibernateVersion;
            
            // Configures the StandardServiceRegistry with dynamic properties
            StandardServiceRegistryBuilder registryBuilder = new StandardServiceRegistryBuilder();
            
            if (dbConfig != null && !dbConfig.isEmpty()) {
                // Basic connection settings
                registryBuilder.applySetting("hibernate.connection.url", dbConfig.get("url"));
                registryBuilder.applySetting("hibernate.connection.username", dbConfig.get("username"));
                registryBuilder.applySetting("hibernate.connection.password", dbConfig.get("password"));
                registryBuilder.applySetting("hibernate.connection.driver_class", dbConfig.get("driver"));
                
                // Determines the database dialect
                String dialect = getDialect(dbConfig.get("url"), hibernateVersion);
                registryBuilder.applySetting("hibernate.dialect", dialect);
                currentDialect = dialect;
                
                // Additional configurations
                registryBuilder.applySetting("hibernate.show_sql", "false");
                registryBuilder.applySetting("hibernate.format_sql", "false");
                registryBuilder.applySetting("hibernate.hbm2ddl.auto", "none");
                registryBuilder.applySetting("hibernate.classLoading.use_current_tccl", "true");
                registryBuilder.applySetting("hibernate.validator.apply_to_ddl", "false");
                registryBuilder.applySetting("hibernate.validator.autoregister_listeners", "false");
                
                // Version-specific configurations
                if (hibernateVersion.startsWith("6")) {
                    registryBuilder.applySetting("hibernate.connection.handling_mode", "DELAYED_ACQUISITION_AND_RELEASE_AFTER_TRANSACTION");
                    registryBuilder.applySetting("hibernate.connection.provider_class", "org.hibernate.hikaricp.internal.HikariCPConnectionProvider");
                    registryBuilder.applySetting("hibernate.current_session_context_class", "thread");
                }
                
            } else {
                throw new IllegalStateException("Database configuration not provided.");
            }

            StandardServiceRegistry registry = registryBuilder.build();
            
            // Ensures that the ClassLoader used by Hibernate is the same used for scanning
            Thread.currentThread().setContextClassLoader(EntityScanner.getEntityClassLoader());
            
            MetadataSources sources = new MetadataSources(registry);
            
            // Adds scanned entities from library
            Set<Class<?>> entities = EntityScanner.scanEntities(entityLibPath, entityPackages);
            
            // If projectScan is enabled and we're not already using persistence.xml 
            // (as persistence.xml already includes project entities)
            if (projectScan && (entityLibPath == null || !entityLibPath.toLowerCase().endsWith("persistence.xml"))) {
                LOG.info("Project scanning enabled, looking for project entities");
                
                // Determine project root directory
                File projectRoot = determineProjectRoot();
                if (projectRoot != null) {
                    LOG.info("Project root determined: {}", projectRoot.getAbsolutePath());
                    
                    // Search for classes directory
                    File classesDir = findClassesDirectory(projectRoot);
                    if (classesDir != null && classesDir.exists()) {
                        LOG.info("Project classes directory found: {}", classesDir.getAbsolutePath());
                        
                        // Scan project entities
                        Set<Class<?>> projectEntities = EntityScanner.scanEntities(
                            classesDir.getAbsolutePath(), 
                            entityPackages
                        );
                        
                        // Add project entities to the set
                        for (Class<?> projectEntity : projectEntities) {
                            if (!entities.contains(projectEntity)) {
                                entities.add(projectEntity);
                                LOG.debug("Added project entity: {}", projectEntity.getName());
                            }
                        }
                    } else {
                        LOG.warn("Could not find project classes directory");
                    }
                } else {
                    LOG.warn("Could not determine project root directory");
                }
            }
            
            if (entities.isEmpty()) {
                LOG.warn("No entities found for mapping.");
            } else {
                LOG.info("Adding {} entities to Hibernate", entities.size());
                
                for (Class<?> entity : entities) {
                    // Add Entity, Embeddable, and MappedSuperclass types
                    if (entity.isAnnotationPresent(Entity.class) || 
                        entity.isAnnotationPresent(Embeddable.class) || 
                        entity.isAnnotationPresent(MappedSuperclass.class)) {
                        
                        sources.addAnnotatedClass(entity);
                        LOG.debug("Class added to Hibernate: {}", entity.getName());
                    } else {
                        LOG.warn("Class {} does not have required JPA annotations, ignoring", entity.getName());
                    }
                }
            }

            // Builds the Metadata and the SessionFactory
            LOG.info("Building Hibernate metadata...");
            Metadata metadata = sources.getMetadataBuilder().build();
            
            // Logs the loaded entities for verification
            listLoadedEntities(metadata); 
            
            LOG.info("Building SessionFactory...");
            
            // Acquires the write lock to update the sessionFactory
            sessionFactoryLock.writeLock().lock();
            try {
                // Closes the existing SessionFactory to avoid resource leaks
                if (sessionFactory != null && !sessionFactory.isClosed()) {
                    LOG.info("Closing existing SessionFactory...");
                    sessionFactory.close();
                }
                
                // Creates new SessionFactory
                sessionFactory = metadata.getSessionFactoryBuilder().build();
            } finally {
                sessionFactoryLock.writeLock().unlock();
            }
            
            LOG.info("Hibernate {} configured successfully!", hibernateVersion);
        } catch (Exception e) {
            LOG.error("Error configuring Hibernate: {}", e.getMessage(), e);
            throw new RuntimeException("Hibernate initialization failed", e);
        }
    }
    
    /**
     * Attempts to determine the project root directory
     */
    private static File determineProjectRoot() {
        try {
            // Get the path of the current class
            String classPath = HibernateManager.class.getProtectionDomain()
                    .getCodeSource()
                    .getLocation()
                    .getPath();
            
            File classDir = new File(classPath);
            
            // If it's a JAR file, get the parent directory
            if (classDir.isFile() && classDir.getName().endsWith(".jar")) {
                classDir = classDir.getParentFile();
            }
            
            // Search for project root
            return findProjectRoot(classDir);
        } catch (Exception e) {
            LOG.error("Error determining project root: {}", e.getMessage());
            return null;
        }
    }
    
    /**
     * Recursively searches for the project root from a directory
     */
    private static File findProjectRoot(File dir) {
        if (dir == null) {
            return null;
        }
        
        // Check for common project root markers
        if (new File(dir, "pom.xml").exists() || 
            new File(dir, "build.gradle").exists() || 
            new File(dir, ".git").exists()) {
            return dir;
        }
        
        // Search in parent directory
        return findProjectRoot(dir.getParentFile());
    }
    
    /**
     * Finds the classes directory in a project
     */
    private static File findClassesDirectory(File projectRoot) {
        // Common locations for compiled classes
        String[] possiblePaths = {
            "target/classes",              // Standard Maven
            "build/classes/java/main",     // Standard Gradle
            "out/production/classes",      // IntelliJ IDEA
            "bin"                          // Eclipse
        };
        
        for (String path : possiblePaths) {
            File dir = new File(projectRoot, path);
            if (dir.exists() && dir.isDirectory()) {
                return dir;
            }
        }
        
        // Recursively search in subdirectories
        File[] subdirs = projectRoot.listFiles(File::isDirectory);
        if (subdirs != null) {
            for (File subdir : subdirs) {
                if (subdir.getName().equals("target") || 
                    subdir.getName().equals("build") || 
                    subdir.getName().equals("out") || 
                    subdir.getName().equals("bin")) {
                    
                    File classesDir = findClassesDirectory(subdir);
                    if (classesDir != null) {
                        return classesDir;
                    }
                }
            }
        }
        
        return null;
    }

    /**
     * Checks if the current configuration is the same as the previous one
     */
    private static boolean isSameConfiguration(Map<String, String> dbConfig, String hibernateVersion) {
        // Checks if the Hibernate version has changed
        if (!hibernateVersion.equals(currentHibernateVersion)) {
            LOG.info("Hibernate version changed: {} -> {}", currentHibernateVersion, hibernateVersion);
            return false;
        }
        
        // Checks if the database dialect has changed
        String newDialect = getDialect(dbConfig.get("url"), hibernateVersion);
        if (!newDialect.equals(currentDialect)) {
            LOG.info("Dialect changed: {} -> {}", currentDialect, newDialect);
            return false;
        }
        
        return true;
    }

    /**
     * Lists the entities loaded in Hibernate
     */
    private static void listLoadedEntities(Metadata metadata) {
        LOG.info("Entities loaded in Hibernate:");
        for (org.hibernate.mapping.PersistentClass entityBinding : metadata.getEntityBindings()) {
            LOG.info("Loaded entity: {}", entityBinding.getClassName());
        }
    }

    /**
     * Determines the Hibernate dialect based on the database URL and Hibernate version
     */
    private static String getDialect(String url, String hibernateVersion) {
        if (url == null) return getDefaultDialect(hibernateVersion);
        
        if (hibernateVersion.startsWith("6")) {
            // Dialects for Hibernate 6.x
            if (url.contains("mysql")) return "org.hibernate.dialect.MySQLDialect";
            if (url.contains("mariadb")) return "org.hibernate.dialect.MariaDBDialect";
            if (url.contains("postgresql")) return "org.hibernate.dialect.PostgreSQLDialect";
            if (url.contains("h2")) return "org.hibernate.dialect.H2Dialect";
            if (url.contains("oracle")) return "org.hibernate.dialect.OracleDialect";
            if (url.contains("sqlserver")) return "org.hibernate.dialect.SQLServerDialect";
            
            return "org.hibernate.dialect.MySQLDialect"; // Default for Hibernate 6
        } else {
            // Dialects for Hibernate 5.x
            if (url.contains("mysql")) return "org.hibernate.dialect.MySQL8Dialect";
            if (url.contains("mariadb")) return "org.hibernate.dialect.MariaDB103Dialect";
            if (url.contains("postgresql")) return "org.hibernate.dialect.PostgreSQL10Dialect";
            if (url.contains("h2")) return "org.hibernate.dialect.H2Dialect";
            if (url.contains("oracle")) return "org.hibernate.dialect.Oracle12cDialect";
            if (url.contains("sqlserver")) return "org.hibernate.dialect.SQLServer2012Dialect";
            
            return "org.hibernate.dialect.MySQL8Dialect"; // Default for Hibernate 5
        }
    }
    
    /**
     * Returns the default dialect based on the Hibernate version
     */
    private static String getDefaultDialect(String hibernateVersion) {
        return hibernateVersion.startsWith("6") 
            ? "org.hibernate.dialect.MySQLDialect"       // Hibernate 6.x
            : "org.hibernate.dialect.MySQL8Dialect";     // Hibernate 5.x
    }

    /**
     * Returns the current SessionFactory, ensuring thread-safe access
     */
    public static SessionFactory getSessionFactory() {
        sessionFactoryLock.readLock().lock();
        try {
            if (sessionFactory == null) {
                throw new IllegalStateException("Hibernate not configured.");
            }
            return sessionFactory;
        } finally {
            sessionFactoryLock.readLock().unlock();
        }
    }
}