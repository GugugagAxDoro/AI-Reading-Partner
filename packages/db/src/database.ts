import DatabaseType from 'better-sqlite3';

export default DatabaseType;
export type Database = InstanceType<typeof DatabaseType>;
