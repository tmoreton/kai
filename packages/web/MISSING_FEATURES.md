# Missing Features Implementation Plan

## Priority 1: Chat Polish (Critical)

### 1. Markdown Rendering
- [ ] Install marked library
- [ ] Create MessageContent component with markdown support
- [ ] Code block syntax highlighting
- [ ] Table rendering
- [ ] Link handling

### 2. Tool Call Display
- [ ] ToolCard component with collapsible details
- [ ] Tool execution status (running/done/error)
- [ ] Diff display for file operations
- [ ] Image preview for generated images

### 3. Image Handling
- [ ] Image attachment previews
- [ ] Lightbox for full-size images
- [ ] Base64 image rendering in messages

### 4. Chat Header
- [ ] Model picker dropdown
- [ ] Token usage indicator
- [ ] Session actions (export, clear, compact)

## Priority 2: Agent Deep Features (High)

### 5. Agent Chat
- [ ] Dedicated agent chat interface
- [ ] Persona context injection
- [ ] File upload for persona context

### 6. Workflow Editor
- [ ] Monaco/CodeMirror YAML editor
- [ ] Syntax validation
- [ ] Auto-save

### 7. Agent Runs
- [ ] Real-time run status polling
- [ ] Step-by-step output display
- [ ] Log viewing with filtering

### 8. Create Forms
- [ ] New persona form
- [ ] New agent form with prompt builder
- [ ] Schedule picker (cron helper)

## Priority 3: Mobile & Polish (Medium)

### 9. Mobile Experience
- [ ] Swipe gestures for sidebar
- [ ] Better keyboard handling
- [ ] Pull-to-refresh
- [ ] Bottom sheet for actions

### 10. PWA Setup
- [ ] manifest.json
- [ ] Service worker
- [ ] Offline indicator

### 11. Advanced Chat Features
- [ ] Edit message
- [ ] Branch conversations
- [ ] Search in chat
- [ ] Pin messages

## Priority 4: Settings Enhancements (Medium)

### 12. Model Management
- [ ] Provider switching
- [ ] Model selection with descriptions
- [ ] Custom model configuration

### 13. System Settings
- [ ] Theme toggle
- [ ] Font size adjustment
- [ ] Auto-compact settings

## Priority 5: Developer Experience (Low)

### 14. DevTools
- [ ] API request inspector
- [ ] State viewer
- [ ] Performance metrics

### 15. Testing
- [ ] Unit tests
- [ ] E2E tests
- [ ] Visual regression
