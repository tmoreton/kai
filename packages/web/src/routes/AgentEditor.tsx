import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { toast } from '../components/Toast';

export function AgentEditor() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const handleSave = () => {
    toast.info('Agent editor coming soon');
    navigate('/agents');
  };

  return (
    <div className="h-full flex flex-col p-6">
      <h1 className="text-2xl font-semibold mb-4">New Agent</h1>
      <div className="space-y-4 max-w-md">
        <div>
          <label className="block text-sm font-medium mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg"
            placeholder="My Agent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg"
            placeholder="What does this agent do?"
          />
        </div>
        <div className="flex gap-2">
          <Button onClick={handleSave}>Save</Button>
          <Button variant="outline" onClick={() => navigate('/agents')}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}
