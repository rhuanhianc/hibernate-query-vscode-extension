package com.querytester;

import org.reflections.Reflections;
import org.reflections.util.ConfigurationBuilder;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.persistence.Entity;
import javax.persistence.Embeddable;
import javax.persistence.MappedSuperclass;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.File;
import java.net.URL;
import java.net.URLClassLoader;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

public class EntityScanner {
    private static final Logger LOG = LoggerFactory.getLogger(EntityScanner.class);
    private static URLClassLoader entityClassLoader;

    /**
     * Scans for entities from a JAR, directory or persistence.xml
     * 
     * @param entityLibPath  Path to JAR, directory or persistence.xml
     * @param entityPackages Packages to be scanned
     * @return Set with found entity classes
     */
    public static Set<Class<?>> scanEntities(String entityLibPath, String[] entityPackages) {
        Set<Class<?>> entities = new HashSet<>();

        if (entityLibPath == null || entityLibPath.isEmpty()) {
            LOG.warn("Entity path not provided, scanning only classpath");
            return scanWithReflections(null, entityPackages);
        }

        File sourceFile = new File(entityLibPath);
        if (!sourceFile.exists()) {
            LOG.error("File not found: {}", entityLibPath);
            return entities;
        }

        // Checks if it's a persistence.xml file
        if (entityLibPath.toLowerCase().endsWith("persistence.xml")) {
            LOG.info("Detected persistence.xml file: {}", entityLibPath);
            return scanFromPersistenceXml(entityLibPath, entityPackages);
        }

        // Otherwise, use Reflections as it was already doing
        return scanWithReflections(entityLibPath, entityPackages);
    }

    private static Set<Class<?>> scanWithReflections(String entityLibPath, String[] entityPackages) {
        Set<Class<?>> entities = new HashSet<>();
        try {
            URL[] urls;
            ClassLoader classLoader;

            if (entityLibPath != null && !entityLibPath.isEmpty()) {
                File file = new File(entityLibPath);
                if (!file.exists()) {
                    LOG.error("File not found: {}", entityLibPath);
                    return entities;
                }
                urls = new URL[]{file.toURI().toURL()};

                // Store the ClassLoader in a static variable so it can be accessed later
                entityClassLoader = new URLClassLoader(urls, Thread.currentThread().getContextClassLoader());
                classLoader = entityClassLoader;

                // Set the ClassLoader in the current thread so Hibernate can use it
                Thread.currentThread().setContextClassLoader(entityClassLoader);

                if (file.isDirectory()) {
                    LOG.info("Scanning entities from directory: {}", entityLibPath);
                } else {
                    LOG.info("Scanning entities from JAR: {}", entityLibPath);
                }
            } else {
                classLoader = Thread.currentThread().getContextClassLoader();

                // If in the classpath, make sure you are using a URLClassLoader
                if (classLoader instanceof URLClassLoader) {
                    urls = ((URLClassLoader) classLoader).getURLs();
                } else {
                    LOG.warn("ClassLoader is not URLClassLoader, there may be class loading issues");
                    urls = new URL[0];
                }

                LOG.info("Scanning entities in system classpath");
            }

            ConfigurationBuilder config = new ConfigurationBuilder().setUrls(urls).setClassLoaders(new ClassLoader[]{classLoader});

            if (entityPackages != null && entityPackages.length > 0) {
                LOG.info("Scanning specific packages: {}", (Object) entityPackages);

                for (String packageName : entityPackages) {
                    LOG.info("Starting scan of package: {}", packageName);

                    Reflections reflections = new Reflections(config.forPackages(packageName));
                    Set<Class<?>> packageEntities = reflections.getTypesAnnotatedWith(Entity.class);
                    Set<Class<?>> embeddables = reflections.getTypesAnnotatedWith(Embeddable.class);
                    Set<Class<?>> mappedSuperclasses = reflections.getTypesAnnotatedWith(MappedSuperclass.class);

                    LOG.info("Found {} entities, {} embeddables and {} mapped superclasses in package {}", packageEntities.size(), embeddables.size(), mappedSuperclasses.size(), packageName);

                    for (Class<?> entity : packageEntities) {
                        String entityPackage = entity.getPackage().getName();
                        if (entityPackage.startsWith(packageName)) {
                            entities.add(entity);
                            LOG.debug("Added entity: {}", entity.getName());
                        }
                    }

                    // Also adds embeddables and mapped superclasses
                    for (Class<?> embeddable : embeddables) {
                        String packageName2 = embeddable.getPackage().getName();
                        if (packageName2.startsWith(packageName)) {
                            entities.add(embeddable);
                            LOG.debug("Added embeddable: {}", embeddable.getName());
                        }
                    }

                    for (Class<?> mappedSuperclass : mappedSuperclasses) {
                        String packageName3 = mappedSuperclass.getPackage().getName();
                        if (packageName3.startsWith(packageName)) {
                            entities.add(mappedSuperclass);
                            LOG.debug("Added mapped superclass: {}", mappedSuperclass.getName());
                        }
                    }
                }
            } else {
                LOG.info("No package specified, scanning all available entities");
                Reflections reflections = new Reflections(config);
                Set<Class<?>> allEntities = reflections.getTypesAnnotatedWith(Entity.class);
                Set<Class<?>> allEmbeddables = reflections.getTypesAnnotatedWith(Embeddable.class);
                Set<Class<?>> allMappedSuperclasses = reflections.getTypesAnnotatedWith(MappedSuperclass.class);

                entities.addAll(allEntities);
                entities.addAll(allEmbeddables);
                entities.addAll(allMappedSuperclasses);

                LOG.info("Found {} entities, {} embeddables and {} mapped superclasses in all packages", allEntities.size(), allEmbeddables.size(), allMappedSuperclasses.size());
            }

            LOG.info("Total classes found: {}", entities.size());
            return entities;
        } catch (Exception e) {
            LOG.error("Error scanning entities: {}", e.getMessage(), e);
            return entities;
        }
    }

    private static Set<Class<?>> scanFromPersistenceXml(String persistenceXmlPath, String[] entityPackages) {
        Set<Class<?>> entities = new HashSet<>();

        try {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            DocumentBuilder builder = factory.newDocumentBuilder();
            Document document = builder.parse(new File(persistenceXmlPath));

            // Normalizes the document
            document.getDocumentElement().normalize();

            // Locates all classes listed in the file
            NodeList classList = document.getElementsByTagName("class");
            List<String> entityClassNames = new ArrayList<>();

            // Extracts class names from persistence.xml
            for (int i = 0; i < classList.getLength(); i++) {
                Element element = (Element) classList.item(i);
                String className = element.getTextContent().trim();
                entityClassNames.add(className);
                LOG.debug("Class found in persistence.xml: {}", className);
            }

            // Locates scanning packages
            NodeList packagesList = document.getElementsByTagName("package");
            List<String> packagesToScan = new ArrayList<>();

            // Adds packages from persistence.xml
            for (int i = 0; i < packagesList.getLength(); i++) {
                Element element = (Element) packagesList.item(i);
                String packageName = element.getTextContent().trim();
                packagesToScan.add(packageName);
                LOG.debug("Package found in persistence.xml: {}", packageName);
            }

            // Adds explicitly specified packages
            if (entityPackages != null && entityPackages.length > 0) {
                packagesToScan.addAll(Arrays.asList(entityPackages));
            }

            // Determines project directory from persistence.xml
            File persistenceFile = new File(persistenceXmlPath);
            File projectRoot = findProjectRoot(persistenceFile);

            if (projectRoot == null) {
                LOG.warn("Could not determine project root from: {}", persistenceXmlPath);
                return entities;
            }

            LOG.info("Project root determined as: {}", projectRoot.getAbsolutePath());

            // Searches for the project's compiled classes directory
            File classesDir = findClassesDirectory(projectRoot);

            if (classesDir != null && classesDir.exists()) {
                LOG.info("Classes directory found: {}", classesDir.getAbsolutePath());

                // Configures ClassLoader with the classes directory
                URL[] urls = new URL[]{classesDir.toURI().toURL()};
                entityClassLoader = new URLClassLoader(urls, Thread.currentThread().getContextClassLoader());
                Thread.currentThread().setContextClassLoader(entityClassLoader);

                if (entityClassNames.isEmpty()) {
                    LOG.warn("No classes found in persistence.xml, scanning project packages");

                    // If there are no packages to scan, scan the project package
                    Set<Class<?>> packageEntities = scanWithReflections(
                            classesDir.getAbsolutePath(), new String[]{projectRoot.getName()}
                    );

                    entities.addAll(packageEntities);

                } else {
                    // Loads entities explicitly listed in persistence.xml
                    for (String className : entityClassNames) {
                        try {
                            Class<?> clazz = entityClassLoader.loadClass(className);
                            entities.add(clazz);
                            LOG.debug("Entity loaded: {}", className);
                        } catch (ClassNotFoundException e) {
                            LOG.warn("Could not load class: {}", className, e);
                        }
                    }
                }

                // Scans additional packages using Reflections if there are packages to scan
                if (!packagesToScan.isEmpty()) {
                    String[] packagesArray = packagesToScan.toArray(new String[0]);
                    LOG.info("Scanning packages from persistence.xml: {}", (Object) packagesArray);

                    // Uses scanWithReflections passing the classes directory and packages to be scanned
                    Set<Class<?>> packageEntities = scanWithReflections(
                            classesDir.getAbsolutePath(), packagesArray
                    );

                    entities.addAll(packageEntities);
                }
            } else {
                LOG.error("Classes directory not found for project: {}", projectRoot.getAbsolutePath());
            }

        } catch (

            Exception e) {
            LOG.error("Error parsing persistence.xml: {}", e.getMessage(), e);
        }

        return entities;
    }

    private static File findProjectRoot(File file) {
        File currentDir = file.getParentFile();

        // Looks for project root indicators (pom.xml, .git, etc.)
        while (currentDir != null) {
            if (new File(currentDir, "pom.xml").exists() || new File(currentDir, ".git").exists() || new File(currentDir, "build.gradle").exists()) {
                return currentDir;
            }
            currentDir = currentDir.getParentFile();
        }

        return null;
    }

    private static File findClassesDirectory(File projectRoot) {
        // Common locations for compilation directories
        String[] possiblePaths = {"target/classes",              // Standard Maven
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

        // Recursively searches in subdirectories
        File[] subdirs = projectRoot.listFiles(File::isDirectory);
        if (subdirs != null) {
            for (File subdir : subdirs) {
                if (subdir.getName().equals("target") || subdir.getName().equals("build") || subdir.getName().equals("out") || subdir.getName().equals("bin")) {

                    File classesDir = findClassesDirectory(subdir);
                    if (classesDir != null) {
                        return classesDir;
                    }
                }
            }
        }

        return null;
    }

    public static ClassLoader getEntityClassLoader() {
        return entityClassLoader != null ? entityClassLoader : Thread.currentThread().getContextClassLoader();
    }
}