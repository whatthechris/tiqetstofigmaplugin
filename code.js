"use strict";
// This plugin allows users to input an API URL, select properties from the JSON response,
// and map those properties to Figma layers for automatic text updates.
// This file holds the main code for plugins. Code in this file has access to
// the *figma document* via the figma global object.
// You can access browser APIs in the <script> tag inside "ui.html" which has a
// full browser environment (See https://www.figma.com/plugin-docs/how-plugins-run).
// This shows the HTML page in "ui.html".
figma.showUI(__html__, { width: 500, height: 750 });
// Function to find a layer by name within a node
function findLayerByName(node, layerName) {
    if (node.name === layerName) {
        return node;
    }
    if ('children' in node) {
        for (const child of node.children) {
            const found = findLayerByName(child, layerName);
            if (found) {
                return found;
            }
        }
    }
    return null;
}
// Function to list all layer names in a node (for debugging)
function listAllLayerNames(node, depth = 0) {
    const indent = '  '.repeat(depth);
    console.log(`${indent}${node.type}: "${node.name}"`);
    if ('children' in node) {
        for (const child of node.children) {
            listAllLayerNames(child, depth + 1);
        }
    }
}
// Function to extract all individual components from a node (including nested ones)
function extractComponentsFromNode(node) {
    const components = [];
    // If this node is a component or instance, add it
    if (node.type === 'COMPONENT' || node.type === 'INSTANCE') {
        components.push(node);
    }
    // If this node has children, recursively search them
    if ('children' in node) {
        for (const child of node.children) {
            const childComponents = extractComponentsFromNode(child);
            components.push(...childComponents);
        }
    }
    return components;
}
// Function to get nested value from an object using dot notation
function getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => {
        return current && current[key] !== undefined ? current[key] : undefined;
    }, obj);
}
// Function to format price values
function formatPriceValue(value, propertyPath) {
    // Check if the property name contains "price" (case insensitive)
    if (!propertyPath.toLowerCase().includes('price')) {
        return String(value);
    }
    // Handle "---" placeholder values
    if (value === "---") {
        return "---";
    }
    // Convert to number if possible
    const numericValue = parseFloat(String(value));
    if (isNaN(numericValue)) {
        return String(value); // Return original if not a valid number
    }
    // Format as Euro currency with 2 decimal places
    return `€${numericValue.toFixed(2)}`;
}
// Function to load image from URL and create Figma image
async function loadImageFromUrl(url) {
    try {
        // Use CORS proxy for image loading
        const proxiedUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
        console.log('Loading image from:', proxiedUrl);
        const response = await fetch(proxiedUrl);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        console.log('Image loaded successfully, size:', arrayBuffer.byteLength);
        return new Uint8Array(arrayBuffer);
    }
    catch (error) {
        console.error('Failed to load image from URL:', url, error);
        return null;
    }
}
// Function to check if a value is an image URL
function isImageUrl(value) {
    if (typeof value !== 'string')
        return false;
    return /\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i.test(value) ||
        value.includes('image') ||
        value.includes('photo') ||
        value.includes('picture');
}
// Calls to "parent.postMessage" from within the HTML page will trigger this
// callback. The callback will be passed the "pluginMessage" property of the
// posted message.
figma.ui.onmessage = async (msg) => {
    if (msg.type === 'apply-to-figma') {
        // Apply mapped values to Figma layers
        if (!msg.mappings || !msg.selectedData || msg.selectedData.length === 0) {
            figma.notify('No mappings or data provided', { error: true });
            return;
        }
        const selectedNodes = figma.currentPage.selection;
        if (selectedNodes.length === 0) {
            figma.notify('Please select one or more components or frames first', { error: true });
            return;
        }
        let successCount = 0;
        let errorCount = 0;
        const errors = [];
        // Apply values from different records to different components
        // We'll determine the actual number of components after extraction
        const recordsToApply = msg.selectedData;
        // Extract all individual components from selected nodes (including those in frames/groups)
        const allComponents = [];
        selectedNodes.forEach(node => {
            const components = extractComponentsFromNode(node);
            allComponents.push(...components);
        });
        console.log(`Found ${allComponents.length} components in selection`);
        // Process each component with its corresponding record
        const componentUpdatePromises = allComponents.map(async (component, index) => {
            // Cycle through records if we have more components than records
            const recordIndex = index % recordsToApply.length;
            const record = recordsToApply[recordIndex];
            if (!record) {
                return { success: false, error: `No data record available for component ${index + 1}` };
            }
            // Debug: List all available layers in the first component
            if (index === 0) {
                console.log('Available layers in component:');
                listAllLayerNames(component);
            }
            // Process all mappings for this component
            const mappingPromises = Object.entries(msg.mappings || {}).map(async ([propertyPath, layerName]) => {
                try {
                    const value = getNestedValue(record, propertyPath);
                    if (value !== undefined) {
                        const targetNode = findLayerByName(component, layerName);
                        console.log(`Looking for layer "${layerName}" in component ${index + 1}, found:`, targetNode ? `${targetNode.type} - ${targetNode.name}` : 'null');
                        if (targetNode) {
                            // Check if this is an image property
                            const isImageProp = msg.imageProperties && msg.imageProperties.includes(propertyPath);
                            if (isImageProp && isImageUrl(value)) {
                                console.log(`Processing image property "${propertyPath}" with value:`, value);
                                console.log(`Target node type:`, targetNode.type);
                                // Handle image loading and application
                                const imageData = await loadImageFromUrl(value);
                                if (imageData) {
                                    try {
                                        console.log('Creating Figma image from data...');
                                        // Create image fill
                                        const imageHash = figma.createImage(imageData).hash;
                                        console.log('Image hash created:', imageHash);
                                        const imageFill = {
                                            type: 'IMAGE',
                                            imageHash: imageHash,
                                            scaleMode: 'FILL'
                                        };
                                        console.log('Applying image fill to node...');
                                        // Apply image fill to the node (works with most node types)
                                        if ('fills' in targetNode) {
                                            targetNode.fills = [imageFill];
                                            console.log('Image fill applied successfully');
                                        }
                                        else {
                                            console.log('Node does not support fills property');
                                            return { success: false, error: `Layer "${layerName}" does not support image fills in component ${index + 1}` };
                                        }
                                        return { success: true, layerName, componentIndex: index, type: 'image' };
                                    }
                                    catch (imageError) {
                                        console.error('Error applying image:', imageError);
                                        return { success: false, error: `Failed to apply image to "${layerName}" in component ${index + 1}: ${imageError}` };
                                    }
                                }
                                else {
                                    return { success: false, error: `Failed to load image from URL for "${layerName}" in component ${index + 1}` };
                                }
                            }
                            else {
                                // Handle text content (existing logic)
                                if (targetNode.type === 'TEXT') {
                                    const textNode = targetNode;
                                    // Load the font if it's not already loaded
                                    const fontName = textNode.fontName;
                                    if (fontName && fontName !== figma.mixed) {
                                        try {
                                            await figma.loadFontAsync(fontName);
                                        }
                                        catch (fontError) {
                                            console.warn(`Failed to load font ${fontName.family} ${fontName.style}:`, fontError);
                                            // Try to load a fallback font
                                            try {
                                                await figma.loadFontAsync({ family: "Inter", style: "Regular" });
                                                textNode.fontName = { family: "Inter", style: "Regular" };
                                            }
                                            catch (fallbackError) {
                                                console.warn("Failed to load fallback font:", fallbackError);
                                            }
                                        }
                                    }
                                    // Format the value (especially for price properties)
                                    const formattedValue = formatPriceValue(value, propertyPath);
                                    textNode.characters = formattedValue;
                                    return { success: true, layerName, componentIndex: index, type: 'text' };
                                }
                                else {
                                    return { success: false, error: `Layer "${layerName}" is not a text layer in component ${index + 1}` };
                                }
                            }
                        }
                        else {
                            return { success: false, error: `Layer "${layerName}" not found in component ${index + 1}` };
                        }
                    }
                    else {
                        return { success: false, error: `Property "${propertyPath}" not found in record ${index + 1}` };
                    }
                }
                catch (error) {
                    return { success: false, error: `Error updating "${layerName}" in component ${index + 1}: ${error}` };
                }
            });
            // Wait for all mappings for this component to complete
            const mappingResults = await Promise.all(mappingPromises);
            return { componentIndex: index, results: mappingResults };
        });
        // Wait for all components to be processed
        const componentResults = await Promise.all(componentUpdatePromises);
        // Count successes and errors across all components
        let imageCount = 0;
        let textCount = 0;
        componentResults.forEach(componentResult => {
            if (componentResult.results) {
                componentResult.results.forEach(result => {
                    if (result.success) {
                        successCount++;
                        if (result.type === 'image') {
                            imageCount++;
                        }
                        else if (result.type === 'text') {
                            textCount++;
                        }
                    }
                    else {
                        errorCount++;
                        if (result.error) {
                            errors.push(result.error);
                        }
                    }
                });
            }
            else {
                errorCount++;
                if (componentResult.error) {
                    errors.push(componentResult.error);
                }
            }
        });
        // Show notification with results
        const componentCount = allComponents.length;
        const recordCount = recordsToApply.length;
        let successMessage = `Successfully updated ${successCount} layer(s) across ${componentCount} component(s)`;
        if (imageCount > 0 && textCount > 0) {
            successMessage += ` (${imageCount} image(s), ${textCount} text layer(s))`;
        }
        else if (imageCount > 0) {
            successMessage += ` (${imageCount} image(s))`;
        }
        else if (textCount > 0) {
            successMessage += ` (${textCount} text layer(s))`;
        }
        if (successCount > 0 && errorCount === 0) {
            figma.notify(successMessage);
        }
        else if (successCount > 0 && errorCount > 0) {
            figma.notify(`${successMessage}, ${errorCount} error(s)`, { error: true });
            console.log('Errors:', errors);
        }
        else {
            figma.notify(`Failed to update any layers. ${errors.join(', ')}`, { error: true });
        }
    }
};
