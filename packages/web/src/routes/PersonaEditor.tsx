// ============================================
// PersonaEditor - Rich text editor for creating/editing AI personas
// ============================================

import { useState, useCallback, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Save,
  Trash2,
  ArrowLeft,
  Bot,
  FileText,
  Target,
  StickyNote,
  Wrench,
  RotateCcw,
  Upload,
  X,
  Paperclip,
  Sparkles,
  AlertCircle,
  CheckCircle,
} from "lucide-react";
import { agentsQueries, settingsQueries } from "../api/queries";
import { personasApi, ApiError, NetworkError, TimeoutError } from "../api/client";
import { cn, formatFileSize } from "../lib/utils";
import { toast } from "../components/Toast";
import type { Persona, FileRef, Skill, McpServer } from "../types/api";

type TabType = 'edit' | 'preview';

interface ErrorState {
  message: string;
  field?: string;
  type: 'error' | 'warning';
}

export function PersonaEditor() {
  const { personaId } = useParams<{ personaId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isEditMode = Boolean(personaId);
  const [error, setError] = useState<ErrorState | null>(null);

  // Load existing persona data if editing
  const { data: agentsData, isError: isAgentsError, error: agentsError } = useSuspenseQuery({
    ...agentsQueries.list(),
    retry: 2,
  });

  // Handle agents data load error
  if (isAgentsError && agentsError && !error) {
    const errorMessage = agentsError instanceof Error ? agentsError.message : 'Failed to load data';
    setError({ message: errorMessage, type: 'error' });
    toast.error('Failed to load data', errorMessage, 10000);
  }

  const existingPersona = personaId
    ? agentsData?.personas.find((p: Persona) => p.id === personaId)
    : null;

  // Load settings for available tools
  const { data: settings, isError: isSettingsError } = useSuspenseQuery({
    ...settingsQueries.list(),
    retry: 2,
  });

  if (isSettingsError && !error) {
    setError({ message: 'Failed to load settings', type: 'warning' });
  }

  // Available tools from MCP servers and skills
  const availableTools = useMemo(() => {
    const tools: { name: string; source: string; description?: string }[] = [];

    // Add MCP server tools
    settings?.mcp.servers.forEach((server: McpServer) => {
      if (server.ready && server.tools) {
        server.tools.forEach((tool) => {
          tools.push({
            name: tool,
            source: `MCP: ${server.name}`,
          });
        });
      }
    });

    // Add skill tools
    settings?.skills.forEach((skill: Skill) => {
      skill.tools.forEach((tool) => {
        tools.push({
          name: tool.name,
          source: `Skill: ${skill.name}`,
          description: tool.description,
        });
      });
    });

    return tools;
  }, [settings]);

  // Form state
  const [formData, setFormData] = useState({
    id: existingPersona?.id || '',
    name: existingPersona?.name || '',
    role: existingPersona?.role || '',
    personality: existingPersona?.personality || '',
    goals: existingPersona?.goals || '',
    scratchpad: existingPersona?.scratchpad || '',
    tools: existingPersona?.tools || [],
    maxTurns: existingPersona?.maxTurns || 10,
    files: existingPersona?.files || [],
  });

  const [activeTab, setActiveTab] = useState<TabType>('edit');
  const [isDirty, setIsDirty] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Mutations
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (isEditMode && personaId) {
        // Update existing persona by updating each field
        const promises = [];
        if (formData.name !== existingPersona?.name) {
          promises.push(personasApi.updateField(personaId, { field: 'name', content: formData.name }));
        }
        if (formData.role !== existingPersona?.role) {
          promises.push(personasApi.updateField(personaId, { field: 'role', content: formData.role }));
        }
        if (formData.personality !== existingPersona?.personality) {
          promises.push(personasApi.updateField(personaId, { field: 'personality', content: formData.personality }));
        }
        if (formData.goals !== existingPersona?.goals) {
          promises.push(personasApi.updateField(personaId, { field: 'goals', content: formData.goals }));
        }
        if (formData.scratchpad !== existingPersona?.scratchpad) {
          promises.push(personasApi.updateField(personaId, { field: 'scratchpad', content: formData.scratchpad }));
        }
        // Tools and maxTurns would need separate API endpoints
        await Promise.all(promises);
        return { id: personaId, name: formData.name };
      } else {
        // Create new persona
        return personasApi.create({
          id: formData.id || formData.name.toLowerCase().replace(/\s+/g, '-'),
          name: formData.name,
          role: formData.role,
          personality: formData.personality,
          goals: formData.goals,
          scratchpad: formData.scratchpad,
          tools: formData.tools,
          maxTurns: formData.maxTurns,
        });
      }
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: agentsQueries.all() });
      setIsDirty(false);
      setError(null);
      toast.success(
        isEditMode ? 'Persona updated' : 'Persona created',
        `${result.name} has been saved successfully`
      );
      if (!isEditMode) {
        navigate(`/agents/${result.id}`);
      }
    },
    onError: (err) => {
      let errorMessage = 'Failed to save persona';
      let field: string | undefined;

      if (err instanceof ApiError) {
        errorMessage = err.message;
        if (err.status === 400) {
          field = 'name'; // Assume validation error on name
        }
      } else if (err instanceof NetworkError) {
        errorMessage = 'Network error. Please check your connection and try again.';
      } else if (err instanceof TimeoutError) {
        errorMessage = 'Request timed out. Please try again.';
      } else if (err instanceof Error) {
        errorMessage = err.message;
      }

      setError({ message: errorMessage, field, type: 'error' });
      toast.error('Save failed', errorMessage, 8000);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!personaId) throw new Error('No persona ID');
      return personasApi.delete(personaId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentsQueries.all() });
      toast.success('Persona deleted', 'The persona has been permanently removed');
      navigate('/agents');
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to delete persona';
      toast.error('Delete failed', message, 8000);
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!personaId) throw new Error('Save persona first to upload files');
      return personasApi.uploadFile(personaId, file);
    },
    onSuccess: (result) => {
      setFormData((prev) => ({
        ...prev,
        files: [...prev.files, result],
      }));
      setIsDirty(true);
      setUploadError(null);
      toast.success('File uploaded', result.originalName);
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Upload failed';
      setUploadError(message);
      toast.error('Upload failed', message);
    },
  });

  const deleteFileMutation = useMutation({
    mutationFn: (storedName: string) => {
      if (!personaId) throw new Error('No persona ID');
      return personasApi.deleteFile(personaId, storedName);
    },
    onSuccess: (_, storedName) => {
      setFormData((prev) => ({
        ...prev,
        files: prev.files.filter((f) => f.storedName !== storedName),
      }));
      setIsDirty(true);
      toast.success('File deleted');
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to delete file';
      toast.error('Delete failed', message);
    },
  });

  // Handlers
  const updateField = useCallback(<K extends keyof typeof formData>(
    field: K,
    value: typeof formData[K]
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setIsDirty(true);
    // Clear error when user starts editing
    if (error?.field === field) {
      setError(null);
    }
  }, [error]);

  const handleToolToggle = useCallback((toolName: string) => {
    setFormData((prev) => {
      const hasTool = prev.tools.includes(toolName);
      return {
        ...prev,
        tools: hasTool
          ? prev.tools.filter((t) => t !== toolName)
          : [...prev.tools, toolName],
      };
    });
    setIsDirty(true);
  }, []);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!personaId) {
        setUploadError('Save the persona first to upload files');
        toast.warning('Save required', 'Please save the persona before uploading files');
        return;
      }
      if (file.size > 10 * 1024 * 1024) { // 10MB limit
        setUploadError('File too large (max 10MB)');
        toast.error('File too large', 'Maximum file size is 10MB');
        return;
      }
      uploadMutation.mutate(file);
    }
    e.target.value = '';
  }, [personaId, uploadMutation]);

  const handleSave = () => {
    // Validate required fields
    if (!formData.name.trim()) {
      setError({ message: 'Name is required', field: 'name', type: 'error' });
      toast.error('Validation Error', 'Please enter a name for the persona');
      return;
    }
    if (!formData.role.trim()) {
      setError({ message: 'Role is required', field: 'role', type: 'error' });
      toast.error('Validation Error', 'Please enter a role for the persona');
      return;
    }

    setError(null);
    saveMutation.mutate();
  };

  const handleDelete = () => {
    if (confirm('Are you sure you want to delete this persona? This cannot be undone.')) {
      deleteMutation.mutate();
    }
  };

  const handleBack = () => {
    if (isDirty && !confirm('You have unsaved changes. Leave without saving?')) {
      return;
    }
    navigate('/agents');
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto p-4 sm:p-6">
        {/* Header */}
        <div className="space-y-3 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 sm:gap-4 min-w-0">
              <button
                onClick={handleBack}
                className="flex items-center gap-1 sm:gap-2 text-muted-foreground hover:text-primary transition-colors flex-shrink-0"
              >
                <ArrowLeft className="w-5 h-5" />
                <span className="text-sm font-medium hidden sm:inline">Back to Agents</span>
              </button>
              <h1 className="text-lg sm:text-2xl font-semibold text-kai-text truncate">
                {isEditMode ? 'Edit Persona' : 'Create Persona'}
              </h1>
              {isDirty && (
                <span className="px-2 py-1 bg-amber-100 text-amber-700 text-xs font-medium rounded flex-shrink-0">
                  Unsaved
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
              {isEditMode && (
                <button
                  onClick={handleDelete}
                  disabled={deleteMutation.isPending}
                  className="flex items-center gap-2 px-3 sm:px-4 py-2 text-destructive border border-kai-red rounded-lg text-sm font-medium hover:bg-destructive/10 transition-colors disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4" />
                  <span className="hidden sm:inline">Delete</span>
                </button>
              )}
              <button
                onClick={handleSave}
                disabled={!isDirty || saveMutation.isPending}
                className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-kai-teal text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                <span className="hidden sm:inline">{saveMutation.isPending ? 'Saving...' : 'Save'}</span>
              </button>
            </div>
          </div>

          {/* Tab switcher for mobile */}
          <div className="flex items-center gap-1 bg-card border border-border rounded-lg p-1 lg:hidden">
            <TabButton
              active={activeTab === 'edit'}
              onClick={() => setActiveTab('edit')}
              icon={<FileText className="w-4 h-4" />}
            >
              Edit
            </TabButton>
            <TabButton
              active={activeTab === 'preview'}
              onClick={() => setActiveTab('preview')}
              icon={<Sparkles className="w-4 h-4" />}
            >
              Tools & Files
            </TabButton>
          </div>
        </div>

        {/* Error Banner */}
        {error && !error.field && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
              <p className="text-red-700 flex-1">{error.message}</p>
            </div>
          </div>
        )}

        {/* Success Toast for saved state */}
        {!isDirty && !error && (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
              <p className="text-green-700">All changes saved</p>
            </div>
          </div>
        )}

        {/* Main content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column - Main fields */}
          <div className={`lg:col-span-2 space-y-6 ${activeTab === 'preview' ? 'hidden lg:block' : ''}`}>
            {/* Basic Info Card */}
            <div className="bg-card border border-border rounded-xl p-6 space-y-4">
              <div className="flex items-center gap-2 mb-4">
                <Bot className="w-5 h-5 text-primary" />
                <h2 className="font-semibold text-kai-text">Basic Information</h2>
              </div>

              {/* ID (only for new personas) */}
              {!isEditMode && (
                <div>
                  <label className="block text-sm font-medium text-kai-text mb-2">
                    Persona ID
                    <span className="text-muted-foreground font-normal ml-1">(unique identifier)</span>
                  </label>
                  <input
                    type="text"
                    value={formData.id}
                    onChange={(e) => updateField('id', e.target.value)}
                    placeholder="e.g., code-assistant"
                    className="w-full px-3 py-2 bg-kai-bg border border-border rounded-lg text-sm focus:border-primary outline-none transition-colors"
                  />
                </div>
              )}

              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-kai-text mb-2">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => updateField('name', e.target.value)}
                  placeholder="e.g., Code Assistant"
                  className={cn(
                    "w-full px-3 py-2 bg-kai-bg border rounded-lg text-sm focus:border-primary outline-none transition-colors",
                    error?.field === 'name' ? 'border-red-500 focus:border-red-500' : 'border-border'
                  )}
                />
                {error?.field === 'name' && (
                  <p className="mt-1 text-sm text-red-500">{error.message}</p>
                )}
              </div>

              {/* Role */}
              <div>
                <label className="block text-sm font-medium text-kai-text mb-2">
                  Role <span className="text-red-500">*</span>
                  <span className="text-muted-foreground font-normal ml-1">(brief description)</span>
                </label>
                <input
                  type="text"
                  value={formData.role}
                  onChange={(e) => updateField('role', e.target.value)}
                  placeholder="e.g., Helps with coding tasks and code review"
                  className={cn(
                    "w-full px-3 py-2 bg-kai-bg border rounded-lg text-sm focus:border-primary outline-none transition-colors",
                    error?.field === 'role' ? 'border-red-500 focus:border-red-500' : 'border-border'
                  )}
                />
                {error?.field === 'role' && (
                  <p className="mt-1 text-sm text-red-500">{error.message}</p>
                )}
              </div>
            </div>

            {/* Personality Card */}
            <div className="bg-card border border-border rounded-xl p-6 space-y-4">
              <div className="flex items-center gap-2 mb-4">
                <Sparkles className="w-5 h-5 text-primary" />
                <h2 className="font-semibold text-kai-text">Personality</h2>
                <span className="text-xs text-muted-foreground ml-auto">
                  {formData.personality?.length || 0} chars
                </span>
              </div>
              <textarea
                value={formData.personality}
                onChange={(e) => updateField('personality', e.target.value)}
                placeholder="Describe the persona's personality, communication style, expertise areas, and how they should behave..."
                className="w-full h-48 px-3 py-2 bg-kai-bg border border-border rounded-lg text-sm resize-none focus:border-primary outline-none transition-colors leading-relaxed"
                spellCheck={false}
              />
              <p className="text-xs text-muted-foreground">
                Define how this persona communicates, their expertise, tone, and behavioral traits.
              </p>
            </div>

            {/* Goals Card */}
            <div className="bg-card border border-border rounded-xl p-6 space-y-4">
              <div className="flex items-center gap-2 mb-4">
                <Target className="w-5 h-5 text-primary" />
                <h2 className="font-semibold text-kai-text">Goals</h2>
                <span className="text-xs text-muted-foreground ml-auto">
                  {formData.goals?.length || 0} chars
                </span>
              </div>
              <textarea
                value={formData.goals}
                onChange={(e) => updateField('goals', e.target.value)}
                placeholder="Describe the persona's primary objectives, what they should help achieve, and key outcomes..."
                className="w-full h-32 px-3 py-2 bg-kai-bg border border-border rounded-lg text-sm resize-none focus:border-primary outline-none transition-colors leading-relaxed"
                spellCheck={false}
              />
            </div>

            {/* Scratchpad Card */}
            <div className="bg-card border border-border rounded-xl p-6 space-y-4">
              <div className="flex items-center gap-2 mb-4">
                <StickyNote className="w-5 h-5 text-primary" />
                <h2 className="font-semibold text-kai-text">Scratchpad</h2>
                <span className="text-xs text-muted-foreground ml-auto">
                  {formData.scratchpad?.length || 0} chars
                </span>
              </div>
              <textarea
                value={formData.scratchpad}
                onChange={(e) => updateField('scratchpad', e.target.value)}
                placeholder="Working notes, context to remember, temporary information..."
                className="w-full h-32 px-3 py-2 bg-kai-bg border border-border rounded-lg text-sm resize-none focus:border-primary outline-none transition-colors leading-relaxed"
                spellCheck={false}
              />
            </div>
          </div>

          {/* Right column - Tools & Files */}
          <div className={`space-y-6 ${activeTab === 'edit' ? 'hidden lg:block' : ''}`}>
            {/* Tools Card */}
            <div className="bg-card border border-border rounded-xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <Wrench className="w-5 h-5 text-primary" />
                <h2 className="font-semibold text-kai-text">Tools</h2>
                <span className="text-xs text-muted-foreground ml-auto">
                  {formData.tools.length} selected
                </span>
              </div>

              <div className="space-y-2 max-h-96 overflow-y-auto">
                {availableTools.map((tool) => (
                  <label
                    key={tool.name}
                    className="flex items-start gap-3 p-2 rounded-lg hover:bg-kai-bg cursor-pointer transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={formData.tools.includes(tool.name)}
                      onChange={() => handleToolToggle(tool.name)}
                      className="mt-0.5 w-4 h-4 rounded border-border text-primary focus:ring-kai-teal"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-kai-text">{tool.name}</div>
                      <div className="text-xs text-muted-foreground">{tool.source}</div>
                      {tool.description && (
                        <div className="text-xs text-muted-foreground mt-0.5">{tool.description}</div>
                      )}
                    </div>
                  </label>
                ))}
                {availableTools.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No tools available. Add MCP servers or skills in Settings.
                  </p>
                )}
              </div>
            </div>

            {/* Files Card */}
            <div className="bg-card border border-border rounded-xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <Paperclip className="w-5 h-5 text-primary" />
                <h2 className="font-semibold text-kai-text">Files</h2>
                <span className="text-xs text-muted-foreground ml-auto">
                  {formData.files.length}
                </span>
              </div>

              {/* Upload */}
              <div className="mb-4">
                <input
                  type="file"
                  id="file-upload"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <label
                  htmlFor="file-upload"
                  className={cn(
                    "flex items-center justify-center gap-2 w-full px-4 py-3 border-2 border-dashed rounded-lg text-sm cursor-pointer transition-colors",
                    uploadMutation.isPending
                      ? "border-primary bg-kai-teal-light text-primary"
                      : "border-border text-muted-foreground hover:border-primary hover:text-primary"
                  )}
                >
                  {uploadMutation.isPending ? (
                    <>
                      <RotateCcw className="w-4 h-4 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4" />
                      Upload File
                    </>
                  )}
                </label>
                {uploadError && (
                  <p className="mt-2 text-sm text-red-500">{uploadError}</p>
                )}
                {!personaId && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Save the persona first to upload files
                  </p>
                )}
              </div>

              {/* File list */}
              <div className="space-y-2">
                {formData.files.map((file: FileRef) => (
                  <div
                    key={file.storedName}
                    className="flex items-center gap-2 p-2 bg-kai-bg rounded-lg group"
                  >
                    <FileText className="w-4 h-4 text-primary flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">{file.originalName}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatFileSize(file.size)} • {file.mimeType}
                      </div>
                    </div>
                    <button
                      onClick={() => deleteFileMutation.mutate(file.storedName)}
                      disabled={deleteFileMutation.isPending}
                      className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-all disabled:opacity-50"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                {formData.files.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No files attached
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
        active
          ? "bg-kai-teal text-white"
          : "text-muted-foreground hover:text-kai-text"
      )}
    >
      {icon}
      {children}
    </button>
  );
}
