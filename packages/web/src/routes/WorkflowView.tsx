import { useParams } from "react-router-dom";
import { WorkflowEditor } from "../components/WorkflowEditor";
import { toast } from "../components/Toast";

export function WorkflowView() {
  const { workflowId } = useParams<{ workflowId: string }>();

  const handleSave = (workflow: unknown, yamlContent: string) => {
    // In a real implementation, this would save to the server
    console.log("Saving workflow:", workflow);
    console.log("YAML content:", yamlContent);
    console.log("Workflow ID:", workflowId);
    
    // Show success toast
    toast.success("Workflow saved", `Saved ${(workflow as { name: string }).name} successfully`);
    
    // Here you would typically call an API:
    // await api.workflows.save(workflowId, workflow, yamlContent);
  };

  return (
    <div className="h-[calc(100vh-4rem)] p-2 sm:p-4">
      <WorkflowEditor
        onSave={handleSave}
      />
    </div>
  );
}

export default WorkflowView;
