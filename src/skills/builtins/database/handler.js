/**
 * Database Skill Handler - Database Operations
 * 
 * Provides migrations, queries, schema inspection, and management
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";

function exec(command, options = {}) {
  try {
    return { success: true, output: execSync(command, { encoding: "utf-8", stdio: "pipe", ...options }) };
  } catch (e) {
    return { success: false, output: e.stdout || e.stderr || e.message, exitCode: e.status };
  }
}

function fileExists(filepath) {
  try {
    fs.accessSync(filepath);
    return true;
  } catch {
    return false;
  }
}

function dirExists(dirpath) {
  try {
    const stats = fs.statSync(dirpath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

function findFiles(pattern) {
  try {
    const result = exec(`find . -type f -name "${pattern}" -maxdepth 2 2>/dev/null | head -5`);
    return result.output?.trim().split("\n").filter(Boolean) || [];
  } catch {
    return [];
  }
}

// Cache for detected framework
let detectedDBFramework = null;

function detectDBFramework() {
  if (detectedDBFramework) return detectedDBFramework;
  
  // Check for prisma
  if (fileExists("prisma/schema.prisma")) {
    detectedDBFramework = "prisma";
    return "prisma";
  }
  
  // Check for TypeORM
  if (fileExists("ormconfig.json") || fileExists("src/data-source.ts")) {
    detectedDBFramework = "typeorm";
    return "typeorm";
  }
  
  // Check for Sequelize
  if (fileExists("config/config.json") || dirExists("models")) {
    detectedDBFramework = "sequelize";
    return "sequelize";
  }
  
  // Check for Knex
  if (fileExists("knexfile.js") || fileExists("knexfile.ts")) {
    detectedDBFramework = "knex";
    return "knex";
  }
  
  // Check for Alembic (Python)
  if (fileExists("alembic.ini")) {
    detectedDBFramework = "alembic";
    return "alembic";
  }
  
  // Check for Flyway
  if (dirExists("src/main/resources/db/migration")) {
    detectedDBFramework = "flyway";
    return "flyway";
  }
  
  detectedDBFramework = "unknown";
  return "unknown";
}

function getMigrateCommand(framework, direction, count) {
  switch (framework) {
    case "prisma":
      if (direction === "down") return "npx prisma migrate dev --create-only";
      return "npx prisma migrate dev";
      
    case "typeorm":
      if (direction === "down") return `npx typeorm migration:revert`;
      return "npx typeorm migration:run";
      
    case "sequelize":
      if (direction === "down") return `npx sequelize-cli db:migrate:undo${count ? ` --to ${count}` : ""}`;
      return "npx sequelize-cli db:migrate";
      
    case "knex":
      if (direction === "down") return `npx knex migrate:rollback${count ? ` --all` : ""}`;
      return "npx knex migrate:latest";
      
    case "alembic":
      if (direction === "down") return `alembic downgrade${count ? ` -${count}` : " -1"}`;
      return "alembic upgrade head";
      
    case "flyway":
      if (direction === "down") return "flyway repair";
      return "flyway migrate";
      
    default:
      return "npm run migrate";
  }
}

function parsePrismaSchema(schema) {
  const models = [];
  const modelRegex = /model\s+(\w+)\s*\{([^}]+)\}/g;
  
  let match;
  while ((match = modelRegex.exec(schema)) !== null) {
    const modelName = match[1];
    const fieldBlock = match[2];
    
    const fields = [];
    const fieldLines = fieldBlock.split("\n").filter(l => l.trim() && !l.trim().startsWith("//"));
    
    for (const line of fieldLines) {
      const fieldMatch = line.match(/^\s*(\w+)\s+(\w+[!?])\s*(.*)$/);
      if (fieldMatch) {
        const fieldName = fieldMatch[1];
        const typeWithOpt = fieldMatch[2];
        const optional = typeWithOpt.endsWith("?");
        const type = typeWithOpt.replace(/[?!]$/, "");
        const isId = line.includes("@id");
        
        fields.push({ name: fieldName, type, optional, isId });
      }
    }
    
    models.push({ name: modelName, fields });
  }
  
  return models;
}

function formatAsMarkdown(models, includeData) {
  let md = "# Database Schema\n\n";
  
  for (const model of models) {
    md += `## ${model.name}\n\n`;
    md += "| Field | Type | Required | ID |\n";
    md += "|-------|------|----------|-----|\n";
    
    for (const field of model.fields) {
      md += `| ${field.name} | ${field.type} | ${field.optional ? "No" : "Yes"} | ${field.isId ? "✓" : ""} |\n`;
    }
    
    md += "\n";
  }
  
  return md;
}

function generateTypeScriptTypes(models) {
  let ts = "// Auto-generated from Prisma schema\n\n";
  
  const mapping = {
    String: "string",
    Int: "number",
    BigInt: "number",
    Float: "number",
    Decimal: "number",
    Boolean: "boolean",
    DateTime: "Date",
    Json: "any",
    Bytes: "Buffer",
  };
  
  for (const model of models) {
    ts += `export interface ${model.name} {\n`;
    for (const field of model.fields) {
      const optional = field.optional ? "?" : "";
      const tsType = mapping[field.type] || field.type;
      ts += `  ${field.name}${optional}: ${tsType};\n`;
    }
    ts += "}\n\n";
  }
  
  return ts;
}

export default {
  actions: {
    db_migrate_run: (params) => {
      const { framework = "auto", direction = "latest", count, dry_run = false } = params;
      
      const fw = framework === "auto" ? detectDBFramework() : framework;
      
      if (fw === "unknown") {
        return { content: "Could not detect migration framework. Please specify framework." };
      }
      
      const cmd = getMigrateCommand(fw, direction, count);
      
      if (dry_run) {
        if (fw === "prisma") {
          const result = exec("npx prisma migrate status");
          return { content: `Dry run (Prisma):\n${result.output || "No status available"}` };
        }
        return { content: `Would run: ${cmd}` };
      }
      
      const result = exec(cmd, { timeout: 120000 });
      
      return { 
        content: result.output || "Migration completed",
        success: result.success
      };
    },

    db_migrate_status: (params) => {
      const { framework = "auto" } = params;
      
      const fw = framework === "auto" ? detectDBFramework() : framework;
      
      if (fw === "unknown") {
        return { content: "Could not detect migration framework." };
      }
      
      let cmd;
      
      switch (fw) {
        case "prisma":
          cmd = "npx prisma migrate status";
          break;
        case "typeorm":
          cmd = "npx typeorm migration:show";
          break;
        case "sequelize":
          cmd = "npx sequelize-cli db:migrate:status";
          break;
        case "knex":
          cmd = "npx knex migrate:status";
          break;
        case "alembic":
          cmd = "alembic current && alembic history --verbose";
          break;
        default:
          return { content: `Status command not available for ${fw}` };
      }
      
      const result = exec(cmd);
      
      return { content: result.output || "No status available" };
    },

    db_query: (params) => {
      const { query, connection, format = "table", max_rows = 100 } = params;
      
      const connStr = connection || process.env.DATABASE_URL || "";
      
      // Determine database type
      let dbType = "sqlite";
      if (connStr.startsWith("postgresql://") || connStr.startsWith("postgres://")) dbType = "postgresql";
      else if (connStr.startsWith("mysql://")) dbType = "mysql";
      
      // Check for local SQLite
      if (!connStr) {
        const dbs = glob.sync("*.db");
        if (dbs.length > 0) dbType = "sqlite";
      }
      
      let cmd;
      
      switch (dbType) {
        case "postgresql":
          cmd = `psql "${connStr}" -c "${query.replace(/"/g, '\\"')}" --pset pager=off`;
          if (format === "json") cmd += " --format=json";
          else if (format === "csv") cmd += " --csv";
          break;
          
        case "sqlite": {
          const dbFiles = glob.sync("*.db");
          const dbFile = dbFiles[0] || "database.db";
          cmd = `sqlite3 ${dbFile} "${query.replace(/"/g, '\\"')}"`;
          if (format === "json") cmd += " -json";
          else if (format === "csv") cmd += " -csv";
          else cmd += " -table";
          break;
        }
          
        default:
          return { content: `Query execution not implemented for ${dbType}` };
      }
      
      const result = exec(cmd, { timeout: 30000 });
      
      let output = result.output || "No output";
      
      // Truncate if too many rows
      const lines = output.split("\n");
      if (lines.length > max_rows + 2) {
        output = lines.slice(0, max_rows + 2).join("\n");
        output += `\n... (${lines.length - max_rows - 2} more rows)`;
      }
      
      return { content: output };
    },

    db_schema_inspect: (params) => {
      const { tables = [], format = "markdown", include_data = false } = params;
      
      // Detect database type
      let dbType = "unknown";
      if (fileExists("prisma/schema.prisma")) {
        dbType = "prisma";
      } else if (glob.sync("*.db").length > 0) {
        dbType = "sqlite";
      }
      
      if (dbType === "prisma") {
        const schema = fs.readFileSync("prisma/schema.prisma", "utf-8");
        
        if (format === "prisma") {
          return { content: schema };
        }
        
        const models = parsePrismaSchema(schema);
        
        if (format === "markdown") {
          return { content: formatAsMarkdown(models, include_data) };
        } else if (format === "typescript") {
          return { content: generateTypeScriptTypes(models) };
        } else {
          return { content: JSON.stringify(models, null, 2) };
        }
      }
      
      if (dbType === "sqlite") {
        const dbs = glob.sync("*.db");
        if (dbs.length === 0) return { content: "No SQLite database found" };
        
        const schema = exec(`sqlite3 ${dbs[0]} ".schema"`);
        return { content: schema.output || "Could not read schema" };
      }
      
      return { content: "Schema inspection not implemented for this database type" };
    },

    db_backup: (params) => {
      const { format = "sql", tables = [], compress = true } = params;
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `backup-${timestamp}.${format}${compress ? ".gz" : ""}`;
      
      const connStr = process.env.DATABASE_URL || "";
      
      let cmd;
      
      if (connStr.includes("postgresql") || exec("which pg_dump").success) {
        if (format === "sql") {
          cmd = `pg_dump ${connStr} > ${filename}`;
        } else {
          return { content: "PostgreSQL backup only supports SQL format" };
        }
      } else {
        const dbs = glob.sync("*.db");
        if (dbs.length > 0) {
          if (format === "sql") {
            cmd = `sqlite3 ${dbs[0]} ".dump" > ${filename}`;
          } else {
            return { content: "SQLite backup only supports SQL format" };
          }
        } else {
          return { content: "No database detected for backup" };
        }
      }
      
      const result = exec(cmd, { timeout: 120000 });
      
      if (!result.success) {
        return { content: `Backup failed: ${result.output}`, error: true };
      }
      
      // Compress if requested
      if (compress) {
        exec(`gzip -f ${filename.replace(".gz", "")}`);
      }
      
      return { content: `Backup created: ${filename}`, filename };
    },

    db_seed: (params) => {
      const { environment = "development", reset = false } = params;
      
      // Check for seed scripts
      const hasPrisma = fileExists("prisma/seed.ts") || fileExists("prisma/seed.js");
      
      let cmd;
      
      if (hasPrisma) {
        cmd = "npx prisma db seed";
      } else if (fileExists("package.json")) {
        const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8"));
        if (pkg.scripts?.seed) {
          cmd = "npm run seed";
        } else {
          return { content: "No seed script found. Add a seed script to package.json or prisma/seed.ts" };
        }
      } else {
        return { content: "No seed mechanism detected" };
      }
      
      if (reset) {
        cmd += " -- --reset";
      }
      
      const result = exec(cmd, { timeout: 60000 });
      
      return { 
        content: result.output || "Seeding completed",
        success: result.success
      };
    }
  }
};
