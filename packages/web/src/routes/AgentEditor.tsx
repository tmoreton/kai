import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { toast } from '../components/Toast';

interface FormErrors {
  name?: string;
  description?: string;
}

export function AgentEditor() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<{ name: boolean; description: boolean }>({
    name: false,
    description: false,
  });

  const validate = (): boolean => {
    const newErrors: FormErrors = {};

    if (!name.trim()) {
      newErrors.name = 'Name is required';
    }

    if (!description.trim()) {
      newErrors.description = 'Description is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = () => {
    setTouched({ name: true, description: true });

    if (!validate()) {
      return;
    }

    toast.info('Agent editor coming soon');
    navigate('/agents');
  };

  const handleNameChange = (value: string) => {
    setName(value);
    if (touched.name) {
      if (!value.trim()) {
        setErrors((prev) => ({ ...prev, name: 'Name is required' }));
      } else {
        setErrors((prev) => ({ ...prev, name: undefined }));
      }
    }
  };

  const handleDescriptionChange = (value: string) => {
    setDescription(value);
    if (touched.description) {
      if (!value.trim()) {
        setErrors((prev) => ({ ...prev, description: 'Description is required' }));
      } else {
        setErrors((prev) => ({ ...prev, description: undefined }));
      }
    }
  };

  const handleNameBlur = () => {
    setTouched((prev) => ({ ...prev, name: true }));
    if (!name.trim()) {
      setErrors((prev) => ({ ...prev, name: 'Name is required' }));
    }
  };

  const handleDescriptionBlur = () => {
    setTouched((prev) => ({ ...prev, description: true }));
    if (!description.trim()) {
      setErrors((prev) => ({ ...prev, description: 'Description is required' }));
    }
  };

  return (
    <div className="h-full flex flex-col p-3 sm:p-4 md:p-6 overflow-y-auto mobile-scroll-container">
      <h1 className="text-xl sm:text-2xl font-semibold mb-4">New Agent</h1>
      <div className="space-y-4 max-w-md w-full">
        <div>
          <label className="block text-sm font-medium mb-1">Name</label>
          <Input
            type="text"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            onBlur={handleNameBlur}
            error={!!errors.name}
            placeholder="My Agent"
          />
          {errors.name && (
            <p className="text-sm text-destructive mt-1">{errors.name}</p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Description</label>
          <Textarea
            value={description}
            onChange={(e) => handleDescriptionChange(e.target.value)}
            onBlur={handleDescriptionBlur}
            error={!!errors.description}
            placeholder="What does this agent do?"
          />
          {errors.description && (
            <p className="text-sm text-destructive mt-1">{errors.description}</p>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button onClick={handleSave} size="sm" className="sm:size-default">Save</Button>
          <Button variant="outline" onClick={() => navigate('/agents')} size="sm" className="sm:size-default">
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
