# @kai/skills-core

Framework-agnostic skill system for AI tools. Load, execute, and manage modular AI tools that work across Kai, Claude Desktop, ChatGPT, and more.

## Quick Start

```typescript
import { SkillLoader, SkillExecutor } from '@kai/skills-core';

// Configure the loader
const loader = new SkillLoader({
  skillsDir: './my-skills',
  logger: console,
});

// Load all skills
const skills = await loader.loadAll();

// Get tool definitions (OpenAI format)
const tools = loader.getToolDefinitions('openai');

// Create executor
const executor = new SkillExecutor({}, skills);

// Execute a tool
const result = await executor.execute('skill__browser__open', {
  url: 'https://example.com'
});
console.log(result);
```

## Installation

```bash
npm install @kai/skills-core
```

## Concepts

### Skill
A skill is a self-contained package of AI tools. It consists of:
- `skill.yaml` - manifest with metadata and tool definitions
- `handler.js` - implementation of the tools

### SkillLoader
Discovers and loads skills from a directory. Configurable and framework-agnostic.

### SkillExecutor
Executes skill tool calls with proper context, error handling, and timeouts.

## Creating a Skill

```yaml
# skill.yaml
id: my-skill
name: My Skill
version: 1.0.0
description: Does useful things
tools:
  - name: doSomething
    description: Do something useful
    parameters:
      input:
        type: string
        required: true
```

```typescript
// handler.js
export default {
  actions: {
    async doSomething(params, context) {
      const { input } = params;
      const { logger } = context;
      
      logger.info(`Processing: ${input}`);
      
      return `Result: ${input.toUpperCase()}`;
    }
  }
};
```

## API Reference

### SkillLoader

```typescript
class SkillLoader {
  constructor(config: SkillLoaderConfig);
  
  loadAll(): Promise<LoadedSkill[]>;
  load(skillPath: string): Promise<LoadedSkill>;
  unload(id: string): Promise<boolean>;
  reloadAll(): Promise<{ loaded: number; errors: string[] }>;
  
  getSkill(id: string): LoadedSkill | undefined;
  getLoadedSkills(): LoadedSkill[];
  getToolDefinitions(format: ToolFormat): GenericToolDefinition[];
}
```

### SkillExecutor

```typescript
class SkillExecutor {
  constructor(config?: SkillExecutorConfig, skills?: LoadedSkill[]);
  
  execute(toolName: string, args: Record<string, unknown>): Promise<ExecutionResult>;
  tryExecute(name: string, args: Record<string, unknown>): Promise<string | null>;
  
  registerSkill(skill: LoadedSkill): void;
  unregisterSkill(id: string): boolean;
}
```

## License

Apache-2.0
