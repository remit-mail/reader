
/**
 * Settings Storage System
 * 
 * A denormalized settings storage system scoped by account configuration ID.
 * Supports flexible querying along multiple dimensions including scope, name, group, and type.
 */

/**
 * Settings value types supported by the system
 */
enum SettingsType {
    STRING: "string",
    NUMBER: "number",
    BOOLEAN: "boolean",
    JSON: "json"
}

/**
 * Settings entity
 * 
 * Primary key: accountConfigId (partition key)
 * Sort key: settingId (unique identifier for the setting)
 * 
 * Local Secondary Indexes:
 * - LSI1: accountConfigId + scope
 * - LSI2: accountConfigId + settingsGroup + settingsName
 * - LSI3: accountConfigId + settingsName
 */
model Settings {
    /**
     * Account configuration ID (partition key)
     * Groups all settings for a specific account configuration
     */
    accountConfigId: string;

    /**
     * Unique identifier for this setting (sort key)
     * Format: {scope}#{group}#{name}#{timestamp}
     * Enables efficient prefix-based queries
     */
    settingId: string;

    /**
     * Scope of the setting (e.g., inbox name or inbox identifier)
     * Used to filter settings by context
     */
    scope: string;

    /**
     * Name of the setting
     */
    settingsName: string;

    /**
     * Group to which this setting belongs
     * Used for organizing related settings
     */
    settingsGroup: string;

    /**
     * Type of the setting value
     */
    settingsType: SettingsType;

    /**
     * The actual value of the setting, stored as string
     * For JSON type, this will be a JSON string
     */
    settingsValue: string;

    /**
     * Timestamp when the setting was created
     */
    createdAt: utcDateTime;

    /**
     * Timestamp when the setting was last updated
     */
    updatedAt: utcDateTime;

    /**
     * Timestamp when the setting was last accessed
     */
    lastAccessedAt?: utcDateTime;
}

/**
 * Query parameters for retrieving settings
 */
model SettingsQuery {
    accountConfigId: string;
    scope?: string;
    settingsGroup?: string;
    settingsName?: string;
    settingsType?: SettingsType;
}

