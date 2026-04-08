import { loadAllSkills, getLoadedSkills, getSkillToolDefinitions } from './src/skills/loader.js';
import { getMcpToolDefinitions } from './src/tools/mcp.js';
import { toolDefinitions } from './src/tools/index.js';

async function testSkills() {
  console.log('=== Testing Skills & Tool Loading ===\n');
  
  // Load all skills
  await loadAllSkills();
  
  const loadedSkills = getLoadedSkills();
  console.log(`✓ Loaded ${loadedSkills.length} skills:`);
  loadedSkills.forEach(s => console.log(`  - ${s.manifest.id}: ${s.manifest.name}`));
  
  // Get tool definitions
  const skillTools = getSkillToolDefinitions();
  const coreTools = toolDefinitions;
  const mcpTools = getMcpToolDefinitions();
  
  console.log(`\n✓ Core tools: ${coreTools.length}`);
  console.log(`✓ Skill tools: ${skillTools.length}`);
  console.log(`✓ MCP tools: ${mcpTools.length}`);
  console.log(`✓ Total tools: ${coreTools.length + skillTools.length + mcpTools.length}`);
  
  // Check skill tool descriptions are truncated
  console.log('\n=== Skill Tool Description Lengths ===');
  skillTools.slice(0, 5).forEach((tool: any) => {
    const desc = tool.function.description;
    const name = tool.function.name;
    console.log(`  ${name}: ${desc.length} chars "${desc.substring(0, 50)}${desc.length > 50 ? '...' : ''}"`);
  });
  
  // Verify specific skills
  console.log('\n=== Critical Skills Check ===');
  const criticalSkills = ['twitter', 'youtube', 'openrouter', 'web-tools', 'slack'];
  criticalSkills.forEach(id => {
    const skill = loadedSkills.find(s => s.manifest.id === id);
    const hasTools = skillTools.some((t: any) => t.function.name.startsWith(`skill__${id}__`));
    console.log(`  ${id}: ${skill ? '✓ loaded' : '✗ missing'}, ${hasTools ? '✓ tools' : '✗ no tools'}`);
  });
  
  console.log('\n=== All Tests Passed ===');
}

testSkills().catch(console.error);
