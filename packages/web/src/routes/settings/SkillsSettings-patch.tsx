// Replace the createMutation onSuccess handler (lines 118-124):
onSuccess: (result) => {
  queryClient.invalidateQueries({ queryKey: settingsQueries.all() });
  setShowCreateForm(false);
  setSkillName("");
  setSkillDescription("");
  setSkillCode(`// Define your skill tools here
// Example: A simple greeting tool

export const tools = {
  greet: async ({ name }: { name: string }) => {
    return { message: \`Hello, \${name}!\` };
  },
};

export const description = "A simple greeting skill";
export const version = "1.0.0";`);
  if (result.updated) {
    toast.success('Skill updated', 'Custom skill saved successfully');
  } else {
    toast.success('Skill created', 'Custom skill created successfully');
  }
},