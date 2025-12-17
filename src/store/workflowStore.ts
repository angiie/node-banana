import { create } from "zustand";
import {
  Connection,
  EdgeChange,
  NodeChange,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  XYPosition,
} from "@xyflow/react";
import {
  WorkflowNode,
  WorkflowEdge,
  NodeType,
  ImageInputNodeData,
  AnnotationNodeData,
  PromptNodeData,
  NanoBananaNodeData,
  LLMGenerateNodeData,
  OutputNodeData,
  WorkflowNodeData,
  ImageHistoryItem,
} from "@/types";
import { useToast } from "@/components/Toast";

export type EdgeStyle = "angular" | "curved";

// Workflow file format
export interface WorkflowFile {
  version: 1;
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  edgeStyle: EdgeStyle;
}

// Clipboard data structure for copy/paste
interface ClipboardData {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

interface WorkflowStore {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  edgeStyle: EdgeStyle;
  clipboard: ClipboardData | null;

  // Settings
  setEdgeStyle: (style: EdgeStyle) => void;

  // Node operations
  addNode: (type: NodeType, position: XYPosition) => string;
  updateNodeData: (nodeId: string, data: Partial<WorkflowNodeData>) => void;
  removeNode: (nodeId: string) => void;
  onNodesChange: (changes: NodeChange<WorkflowNode>[]) => void;

  // Edge operations
  onEdgesChange: (changes: EdgeChange<WorkflowEdge>[]) => void;
  onConnect: (connection: Connection) => void;
  removeEdge: (edgeId: string) => void;
  toggleEdgePause: (edgeId: string) => void;

  // Copy/Paste operations
  copySelectedNodes: () => void;
  pasteNodes: (offset?: XYPosition) => void;
  clearClipboard: () => void;

  // Execution
  isRunning: boolean;
  currentNodeId: string | null;
  pausedAtNodeId: string | null;
  executeWorkflow: (startFromNodeId?: string) => Promise<void>;
  regenerateNode: (nodeId: string) => Promise<void>;
  stopWorkflow: () => void;

  saveWorkflow: (name?: string) => void;
  exportWorkflowHtml: () => void;
  loadWorkflow: (workflow: WorkflowFile) => void;
  clearWorkflow: () => void;

  // Helpers
  getNodeById: (id: string) => WorkflowNode | undefined;
  getConnectedInputs: (nodeId: string) => { images: string[]; text: string | null };
  validateWorkflow: () => { valid: boolean; errors: string[] };

  // Global Image History
  globalImageHistory: ImageHistoryItem[];
  addToGlobalHistory: (item: Omit<ImageHistoryItem, "id">) => void;
  clearGlobalHistory: () => void;
}

const createDefaultNodeData = (type: NodeType): WorkflowNodeData => {
  switch (type) {
    case "imageInput":
      return {
        image: null,
        filename: null,
        dimensions: null,
      } as ImageInputNodeData;
    case "annotation":
      return {
        sourceImage: null,
        annotations: [],
        outputImage: null,
      } as AnnotationNodeData;
    case "prompt":
      return {
        prompt: "",
      } as PromptNodeData;
    case "nanoBanana":
      return {
        inputImages: [],
        inputPrompt: null,
        outputImage: null,
        aspectRatio: "1:1",
        resolution: "4K",
        model: "nano-banana-pro",
        useGoogleSearch: false,
        status: "idle",
        error: null,
      } as NanoBananaNodeData;
    case "llmGenerate":
      return {
        inputPrompt: null,
        outputText: null,
        provider: "google",
        model: "gemini-2.5-flash",
        temperature: 0.7,
        maxTokens: 1024,
        status: "idle",
        error: null,
      } as LLMGenerateNodeData;
    case "output":
      return {
        image: null,
      } as OutputNodeData;
  }
};

let nodeIdCounter = 0;

export const useWorkflowStore = create<WorkflowStore>((set, get) => ({
  nodes: [],
  edges: [],
  edgeStyle: "curved" as EdgeStyle,
  clipboard: null,
  isRunning: false,
  currentNodeId: null,
  pausedAtNodeId: null,
  globalImageHistory: [],

  setEdgeStyle: (style: EdgeStyle) => {
    set({ edgeStyle: style });
  },

  addNode: (type: NodeType, position: XYPosition) => {
    const id = `${type}-${++nodeIdCounter}`;

    // Default dimensions based on node type
    const defaultDimensions: Record<NodeType, { width: number; height: number }> = {
      imageInput: { width: 300, height: 280 },
      annotation: { width: 300, height: 280 },
      prompt: { width: 320, height: 220 },
      nanoBanana: { width: 300, height: 300 },
      llmGenerate: { width: 320, height: 360 },
      output: { width: 320, height: 320 },
    };

    const { width, height } = defaultDimensions[type];

    const newNode: WorkflowNode = {
      id,
      type,
      position,
      data: createDefaultNodeData(type),
      style: { width, height },
    };

    set((state) => ({
      nodes: [...state.nodes, newNode],
    }));

    return id;
  },

  updateNodeData: (nodeId: string, data: Partial<WorkflowNodeData>) => {
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, ...data } as WorkflowNodeData }
          : node
      ) as WorkflowNode[],
    }));
  },

  removeNode: (nodeId: string) => {
    set((state) => ({
      nodes: state.nodes.filter((node) => node.id !== nodeId),
      edges: state.edges.filter(
        (edge) => edge.source !== nodeId && edge.target !== nodeId
      ),
    }));
  },

  onNodesChange: (changes: NodeChange<WorkflowNode>[]) => {
    set((state) => ({
      nodes: applyNodeChanges(changes, state.nodes),
    }));
  },

  onEdgesChange: (changes: EdgeChange<WorkflowEdge>[]) => {
    set((state) => ({
      edges: applyEdgeChanges(changes, state.edges),
    }));
  },

  onConnect: (connection: Connection) => {
    set((state) => ({
      edges: addEdge(
        {
          ...connection,
          id: `edge-${connection.source}-${connection.target}-${connection.sourceHandle || "default"}-${connection.targetHandle || "default"}`,
        },
        state.edges
      ),
    }));
  },

  removeEdge: (edgeId: string) => {
    set((state) => ({
      edges: state.edges.filter((edge) => edge.id !== edgeId),
    }));
  },

  toggleEdgePause: (edgeId: string) => {
    set((state) => ({
      edges: state.edges.map((edge) =>
        edge.id === edgeId
          ? { ...edge, data: { ...edge.data, hasPause: !edge.data?.hasPause } }
          : edge
      ),
    }));
  },

  copySelectedNodes: () => {
    const { nodes, edges } = get();
    const selectedNodes = nodes.filter((node) => node.selected);

    if (selectedNodes.length === 0) return;

    const selectedNodeIds = new Set(selectedNodes.map((n) => n.id));

    // Copy edges that connect selected nodes to each other
    const connectedEdges = edges.filter(
      (edge) => selectedNodeIds.has(edge.source) && selectedNodeIds.has(edge.target)
    );

    // Deep clone the nodes and edges to avoid reference issues
    const clonedNodes = JSON.parse(JSON.stringify(selectedNodes)) as WorkflowNode[];
    const clonedEdges = JSON.parse(JSON.stringify(connectedEdges)) as WorkflowEdge[];

    set({ clipboard: { nodes: clonedNodes, edges: clonedEdges } });
  },

  pasteNodes: (offset: XYPosition = { x: 50, y: 50 }) => {
    const { clipboard, nodes, edges } = get();

    if (!clipboard || clipboard.nodes.length === 0) return;

    // Create a mapping from old node IDs to new node IDs
    const idMapping = new Map<string, string>();

    // Generate new IDs for all pasted nodes
    clipboard.nodes.forEach((node) => {
      const newId = `${node.type}-${++nodeIdCounter}`;
      idMapping.set(node.id, newId);
    });

    // Create new nodes with updated IDs and offset positions
    const newNodes: WorkflowNode[] = clipboard.nodes.map((node) => ({
      ...node,
      id: idMapping.get(node.id)!,
      position: {
        x: node.position.x + offset.x,
        y: node.position.y + offset.y,
      },
      selected: true, // Select newly pasted nodes
      data: { ...node.data }, // Deep copy data
    }));

    // Create new edges with updated source/target IDs
    const newEdges: WorkflowEdge[] = clipboard.edges.map((edge) => ({
      ...edge,
      id: `edge-${idMapping.get(edge.source)}-${idMapping.get(edge.target)}-${edge.sourceHandle || "default"}-${edge.targetHandle || "default"}`,
      source: idMapping.get(edge.source)!,
      target: idMapping.get(edge.target)!,
    }));

    // Deselect existing nodes and add new ones
    const updatedNodes = nodes.map((node) => ({
      ...node,
      selected: false,
    }));

    set({
      nodes: [...updatedNodes, ...newNodes] as WorkflowNode[],
      edges: [...edges, ...newEdges],
    });
  },

  clearClipboard: () => {
    set({ clipboard: null });
  },

  getNodeById: (id: string) => {
    return get().nodes.find((node) => node.id === id);
  },

  getConnectedInputs: (nodeId: string) => {
    const { edges, nodes } = get();
    const images: string[] = [];
    let text: string | null = null;

    edges
      .filter((edge) => edge.target === nodeId)
      .forEach((edge) => {
        const sourceNode = nodes.find((n) => n.id === edge.source);
        if (!sourceNode) return;

        const handleId = edge.targetHandle;

        if (handleId === "image" || !handleId) {
          // Get image from source node - collect all connected images
          if (sourceNode.type === "imageInput") {
            const sourceImage = (sourceNode.data as ImageInputNodeData).image;
            if (sourceImage) images.push(sourceImage);
          } else if (sourceNode.type === "annotation") {
            const sourceImage = (sourceNode.data as AnnotationNodeData).outputImage;
            if (sourceImage) images.push(sourceImage);
          } else if (sourceNode.type === "nanoBanana") {
            const sourceImage = (sourceNode.data as NanoBananaNodeData).outputImage;
            if (sourceImage) images.push(sourceImage);
          }
        }

        if (handleId === "text") {
          if (sourceNode.type === "prompt") {
            text = (sourceNode.data as PromptNodeData).prompt;
          } else if (sourceNode.type === "llmGenerate") {
            text = (sourceNode.data as LLMGenerateNodeData).outputText;
          }
        }
      });

    return { images, text };
  },

  validateWorkflow: () => {
    const { nodes, edges } = get();
    const errors: string[] = [];

    // Check if there are any nodes
    if (nodes.length === 0) {
      errors.push("Workflow is empty");
      return { valid: false, errors };
    }

    // Check each Nano Banana node has required inputs
    nodes
      .filter((n) => n.type === "nanoBanana")
      .forEach((node) => {
        const imageConnected = edges.some(
          (e) => e.target === node.id && e.targetHandle === "image"
        );
        const textConnected = edges.some(
          (e) => e.target === node.id && e.targetHandle === "text"
        );

        if (!imageConnected) {
          errors.push(`Generate node "${node.id}" missing image input`);
        }
        if (!textConnected) {
          errors.push(`Generate node "${node.id}" missing text input`);
        }
      });

    // Check annotation nodes have image input (either connected or manually loaded)
    nodes
      .filter((n) => n.type === "annotation")
      .forEach((node) => {
        const imageConnected = edges.some((e) => e.target === node.id);
        const hasManualImage = (node.data as AnnotationNodeData).sourceImage !== null;
        if (!imageConnected && !hasManualImage) {
          errors.push(`Annotation node "${node.id}" missing image input`);
        }
      });

    // Check output nodes have image input
    nodes
      .filter((n) => n.type === "output")
      .forEach((node) => {
        const imageConnected = edges.some((e) => e.target === node.id);
        if (!imageConnected) {
          errors.push(`Output node "${node.id}" missing image input`);
        }
      });

    return { valid: errors.length === 0, errors };
  },

  executeWorkflow: async (startFromNodeId?: string) => {
    const { nodes, edges, updateNodeData, getConnectedInputs, isRunning } = get();

    if (isRunning) {
      return;
    }

    const isResuming = startFromNodeId === get().pausedAtNodeId;
    set({ isRunning: true, pausedAtNodeId: null });

    // Topological sort
    const sorted: WorkflowNode[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (nodeId: string) => {
      if (visited.has(nodeId)) return;
      if (visiting.has(nodeId)) {
        throw new Error("Cycle detected in workflow");
      }

      visiting.add(nodeId);

      // Visit all nodes that this node depends on
      edges
        .filter((e) => e.target === nodeId)
        .forEach((e) => visit(e.source));

      visiting.delete(nodeId);
      visited.add(nodeId);

      const node = nodes.find((n) => n.id === nodeId);
      if (node) sorted.push(node);
    };

    try {
      nodes.forEach((node) => visit(node.id));

      // If starting from a specific node, find its index and skip earlier nodes
      let startIndex = 0;
      if (startFromNodeId) {
        const nodeIndex = sorted.findIndex((n) => n.id === startFromNodeId);
        if (nodeIndex !== -1) {
          startIndex = nodeIndex;
        }
      }

      // Execute nodes in order, starting from startIndex
      for (let i = startIndex; i < sorted.length; i++) {
        const node = sorted[i];
        if (!get().isRunning) break;

        // Check for pause edges on incoming connections (skip if resuming from this exact node)
        const isResumingThisNode = isResuming && node.id === startFromNodeId;
        if (!isResumingThisNode) {
          const incomingEdges = edges.filter((e) => e.target === node.id);
          const pauseEdge = incomingEdges.find((e) => e.data?.hasPause);
          if (pauseEdge) {
            set({ pausedAtNodeId: node.id, isRunning: false, currentNodeId: null });
            useToast.getState().show("Workflow paused - click Run to continue", "warning");
            return;
          }
        }

        set({ currentNodeId: node.id });

        switch (node.type) {
          case "imageInput":
            // Nothing to execute, data is already set
            break;

          case "annotation": {
            // Get connected image and set as source (use first image)
            const { images } = getConnectedInputs(node.id);
            const image = images[0] || null;
            if (image) {
              updateNodeData(node.id, { sourceImage: image });
              // If no annotations, pass through the image
              const nodeData = node.data as AnnotationNodeData;
              if (!nodeData.outputImage) {
                updateNodeData(node.id, { outputImage: image });
              }
            }
            break;
          }

          case "prompt":
            // Nothing to execute, data is already set
            break;

          case "nanoBanana": {
            const { images, text } = getConnectedInputs(node.id);

            if (images.length === 0 || !text) {
              updateNodeData(node.id, {
                status: "error",
                error: "Missing image or text input",
              });
              set({ isRunning: false, currentNodeId: null });
              return;
            }

            updateNodeData(node.id, {
              inputImages: images,
              inputPrompt: text,
              status: "loading",
              error: null,
            });

            try {
              const nodeData = node.data as NanoBananaNodeData;

              const requestPayload = {
                images,
                prompt: text,
                aspectRatio: nodeData.aspectRatio,
                resolution: nodeData.resolution,
                model: nodeData.model,
                useGoogleSearch: nodeData.useGoogleSearch,
              };

              const response = await fetch("/api/generate", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(requestPayload),
              });

              if (!response.ok) {
                const errorText = await response.text();
                let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
                try {
                  const errorJson = JSON.parse(errorText);
                  errorMessage = errorJson.error || errorMessage;
                } catch {
                  if (errorText) errorMessage += ` - ${errorText.substring(0, 200)}`;
                }

                updateNodeData(node.id, {
                  status: "error",
                  error: errorMessage,
                });
                set({ isRunning: false, currentNodeId: null });
                return;
              }

              const result = await response.json();

              if (result.success && result.image) {
                // Save the newly generated image to global history
                get().addToGlobalHistory({
                  image: result.image,
                  timestamp: Date.now(),
                  prompt: text,
                  aspectRatio: nodeData.aspectRatio,
                  model: nodeData.model,
                });
                updateNodeData(node.id, {
                  outputImage: result.image,
                  status: "complete",
                  error: null,
                });
              } else {
                updateNodeData(node.id, {
                  status: "error",
                  error: result.error || "Generation failed",
                });
                set({ isRunning: false, currentNodeId: null });
                return;
              }
            } catch (error) {
              let errorMessage = "Generation failed";
              if (error instanceof DOMException && error.name === 'AbortError') {
                errorMessage = "Request timed out. Try reducing image sizes or using a simpler prompt.";
              } else if (error instanceof TypeError && error.message.includes('NetworkError')) {
                errorMessage = "Network error. Check your connection and try again.";
              } else if (error instanceof TypeError) {
                errorMessage = `Network error: ${error.message}`;
              } else if (error instanceof Error) {
                errorMessage = error.message;
              }

              updateNodeData(node.id, {
                status: "error",
                error: errorMessage,
              });
              set({ isRunning: false, currentNodeId: null });
              return;
            }
            break;
          }

          case "llmGenerate": {
            const { text } = getConnectedInputs(node.id);

            if (!text) {
              updateNodeData(node.id, {
                status: "error",
                error: "Missing text input",
              });
              set({ isRunning: false, currentNodeId: null });
              return;
            }

            updateNodeData(node.id, {
              inputPrompt: text,
              status: "loading",
              error: null,
            });

            try {
              const nodeData = node.data as LLMGenerateNodeData;
              const response = await fetch("/api/llm", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  prompt: text,
                  provider: nodeData.provider,
                  model: nodeData.model,
                  temperature: nodeData.temperature,
                  maxTokens: nodeData.maxTokens,
                }),
              });

              if (!response.ok) {
                const errorText = await response.text();
                let errorMessage = `HTTP ${response.status}`;
                try {
                  const errorJson = JSON.parse(errorText);
                  errorMessage = errorJson.error || errorMessage;
                } catch {
                  if (errorText) errorMessage += ` - ${errorText.substring(0, 200)}`;
                }
                updateNodeData(node.id, {
                  status: "error",
                  error: errorMessage,
                });
                set({ isRunning: false, currentNodeId: null });
                return;
              }

              const result = await response.json();

              if (result.success && result.text) {
                updateNodeData(node.id, {
                  outputText: result.text,
                  status: "complete",
                  error: null,
                });
              } else {
                updateNodeData(node.id, {
                  status: "error",
                  error: result.error || "LLM generation failed",
                });
                set({ isRunning: false, currentNodeId: null });
                return;
              }
            } catch (error) {
              updateNodeData(node.id, {
                status: "error",
                error: error instanceof Error ? error.message : "LLM generation failed",
              });
              set({ isRunning: false, currentNodeId: null });
              return;
            }
            break;
          }

          case "output": {
            const { images } = getConnectedInputs(node.id);
            const image = images[0] || null;
            if (image) {
              updateNodeData(node.id, { image });
            }
            break;
          }
        }
      }

      set({ isRunning: false, currentNodeId: null });
    } catch {
      set({ isRunning: false, currentNodeId: null });
    }
  },

  stopWorkflow: () => {
    set({ isRunning: false, currentNodeId: null });
  },

  regenerateNode: async (nodeId: string) => {
    const { nodes, updateNodeData, getConnectedInputs, isRunning } = get();

    if (isRunning) {
      return;
    }

    const node = nodes.find((n) => n.id === nodeId);
    if (!node) {
      return;
    }

    set({ isRunning: true, currentNodeId: nodeId });

    try {
      if (node.type === "nanoBanana") {
        const nodeData = node.data as NanoBananaNodeData;

        // Always get fresh connected inputs first, fall back to stored inputs only if not connected
        const inputs = getConnectedInputs(nodeId);
        let images = inputs.images.length > 0 ? inputs.images : nodeData.inputImages;
        let text = inputs.text ?? nodeData.inputPrompt;

        if (!images || images.length === 0 || !text) {
          updateNodeData(nodeId, {
            status: "error",
            error: "Missing image or text input",
          });
          set({ isRunning: false, currentNodeId: null });
          return;
        }

        updateNodeData(nodeId, {
          status: "loading",
          error: null,
        });

        const response = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            images,
            prompt: text,
            aspectRatio: nodeData.aspectRatio,
            resolution: nodeData.resolution,
            model: nodeData.model,
            useGoogleSearch: nodeData.useGoogleSearch,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          let errorMessage = `HTTP ${response.status}`;
          try {
            const errorJson = JSON.parse(errorText);
            errorMessage = errorJson.error || errorMessage;
          } catch {
            if (errorText) errorMessage += ` - ${errorText.substring(0, 200)}`;
          }
          updateNodeData(nodeId, { status: "error", error: errorMessage });
          set({ isRunning: false, currentNodeId: null });
          return;
        }

        const result = await response.json();
        if (result.success && result.image) {
          // Save the newly generated image to global history
          get().addToGlobalHistory({
            image: result.image,
            timestamp: Date.now(),
            prompt: text,
            aspectRatio: nodeData.aspectRatio,
            model: nodeData.model,
          });
          updateNodeData(nodeId, {
            outputImage: result.image,
            status: "complete",
            error: null,
          });
        } else {
          updateNodeData(nodeId, {
            status: "error",
            error: result.error || "Generation failed",
          });
        }
      } else if (node.type === "llmGenerate") {
        const nodeData = node.data as LLMGenerateNodeData;

        // Always get fresh connected input first, fall back to stored input only if not connected
        const inputs = getConnectedInputs(nodeId);
        const text = inputs.text ?? nodeData.inputPrompt;

        if (!text) {
          updateNodeData(nodeId, {
            status: "error",
            error: "Missing text input",
          });
          set({ isRunning: false, currentNodeId: null });
          return;
        }

        updateNodeData(nodeId, {
          status: "loading",
          error: null,
        });

        const response = await fetch("/api/llm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: text,
            provider: nodeData.provider,
            model: nodeData.model,
            temperature: nodeData.temperature,
            maxTokens: nodeData.maxTokens,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          let errorMessage = `HTTP ${response.status}`;
          try {
            const errorJson = JSON.parse(errorText);
            errorMessage = errorJson.error || errorMessage;
          } catch {
            if (errorText) errorMessage += ` - ${errorText.substring(0, 200)}`;
          }
          updateNodeData(nodeId, { status: "error", error: errorMessage });
          set({ isRunning: false, currentNodeId: null });
          return;
        }

        const result = await response.json();
        if (result.success && result.text) {
          updateNodeData(nodeId, {
            outputText: result.text,
            status: "complete",
            error: null,
          });
        } else {
          updateNodeData(nodeId, {
            status: "error",
            error: result.error || "LLM generation failed",
          });
        }
      }

      set({ isRunning: false, currentNodeId: null });
    } catch (error) {
      updateNodeData(nodeId, {
        status: "error",
        error: error instanceof Error ? error.message : "Regeneration failed",
      });
      set({ isRunning: false, currentNodeId: null });
    }
  },

  saveWorkflow: (name?: string) => {
    const { nodes, edges, edgeStyle } = get();

    const workflow: WorkflowFile = {
      version: 1,
      name: name || `workflow-${new Date().toISOString().slice(0, 10)}`,
      nodes,
      edges,
      edgeStyle,
    };

    const json = JSON.stringify(workflow, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `${workflow.name}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },

  exportWorkflowHtml: () => {
    const { nodes, edges, edgeStyle } = get();

    const workflow: WorkflowFile = {
      version: 1,
      name: `workflow-${new Date().toISOString().slice(0, 10)}`,
      nodes,
      edges,
      edgeStyle,
    };

    const json = JSON.stringify(workflow, null, 2);

    const escapeHtml = (value: string) =>
      value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

    const incoming: Record<string, string[]> = {};
    const outgoing: Record<string, string[]> = {};

    edges.forEach((edge) => {
      const sourceId = edge.source;
      const targetId = edge.target;
      if (!outgoing[sourceId]) {
        outgoing[sourceId] = [];
      }
      if (!incoming[targetId]) {
        incoming[targetId] = [];
      }
      outgoing[sourceId].push(targetId);
      incoming[targetId].push(sourceId);
    });

    const nodeCards = nodes
      .map((node) => {
        const nodeId = node.id;
        const type = node.type;
        const safeId = escapeHtml(nodeId);
        const safeType = escapeHtml(type);
        const data = node.data as any;

        const incomingList = (incoming[nodeId] || [])
          .map((id) => `<span class="badge">${escapeHtml(id)}</span>`)
          .join(" ") || '<span class="muted">None</span>';

        const outgoingList = (outgoing[nodeId] || [])
          .map((id) => `<span class="badge">${escapeHtml(id)}</span>`)
          .join(" ") || '<span class="muted">None</span>';

        let promptPreview = "";
        if (type === "prompt" && typeof data.prompt === "string") {
          promptPreview = escapeHtml(
            data.prompt.length > 160 ? `${data.prompt.slice(0, 160)}...` : data.prompt
          );
        } else if (type === "nanoBanana" && typeof data.inputPrompt === "string" && data.inputPrompt) {
          promptPreview = escapeHtml(
            data.inputPrompt.length > 160 ? `${data.inputPrompt.slice(0, 160)}...` : data.inputPrompt
          );
        } else if (type === "llmGenerate" && typeof data.inputPrompt === "string" && data.inputPrompt) {
          promptPreview = escapeHtml(
            data.inputPrompt.length > 160 ? `${data.inputPrompt.slice(0, 160)}...` : data.inputPrompt
          );
        }

        let imageUrls: string[] = [];
        if (type === "imageInput" && typeof data.image === "string" && data.image) {
          imageUrls.push(data.image);
        }
        if (type === "annotation") {
          if (typeof data.outputImage === "string" && data.outputImage) {
            imageUrls.push(data.outputImage);
          } else if (typeof data.sourceImage === "string" && data.sourceImage) {
            imageUrls.push(data.sourceImage);
          }
        }
        if (type === "nanoBanana") {
          if (Array.isArray(data.inputImages)) {
            imageUrls = imageUrls.concat(
              data.inputImages.filter((v: unknown) => typeof v === "string" && v)
            );
          }
          if (typeof data.outputImage === "string" && data.outputImage) {
            imageUrls.push(data.outputImage);
          }
        }
        if (type === "output" && typeof data.image === "string" && data.image) {
          imageUrls.push(data.image);
        }

        const limitedImages = imageUrls.slice(0, 4);
        const hasMoreImages = imageUrls.length > limitedImages.length;

        const imagesHtml = limitedImages.length
          ? `<div class="images">
  ${limitedImages
    .map(
      (src, index) =>
        `<div class="image-frame">
  <img src="${src}" alt="node image" />
  <a href="${src}" download="node-${safeId}-${index + 1}.png" class="image-download-button">Download</a>
</div>`
    )
    .join("")}
  ${
    hasMoreImages
      ? `<div class="image-more">+${imageUrls.length - limitedImages.length} more</div>`
      : ""
  }
</div>`
          : "";

        const metaParts: string[] = [];
        if (type === "nanoBanana") {
          if (data.model) {
            metaParts.push(`Model: ${escapeHtml(String(data.model))}`);
          }
          if (data.aspectRatio) {
            metaParts.push(`Aspect: ${escapeHtml(String(data.aspectRatio))}`);
          }
          if (data.resolution) {
            metaParts.push(`Resolution: ${escapeHtml(String(data.resolution))}`);
          }
        }
        if (type === "llmGenerate") {
          if (data.provider) {
            metaParts.push(`Provider: ${escapeHtml(String(data.provider))}`);
          }
          if (data.model) {
            metaParts.push(`Model: ${escapeHtml(String(data.model))}`);
          }
        }
        const metaLine = metaParts.length
          ? `<div class="meta">${metaParts.join(" · ")}</div>`
          : "";

        const promptBlock = promptPreview
          ? `<div class="prompt-block"><div class="section-title">Prompt</div><div class="prompt-text">${promptPreview}</div></div>`
          : "";

        return `<div class="node-card">
  <div class="node-header">
    <div class="node-type">${safeType}</div>
    <div class="node-id">${safeId}</div>
  </div>
  ${metaLine}
  ${imagesHtml}
  <div class="connections">
    <div><span class="section-title">Incoming</span> ${incomingList}</div>
    <div><span class="section-title">Outgoing</span> ${outgoingList}</div>
  </div>
  ${promptBlock}
</div>`;
      })
      .join("");

    const edgeList = edges
      .map(
        (edge) =>
          `<li><code>${escapeHtml(edge.source)}</code> → <code>${escapeHtml(
            edge.target
          )}</code></li>`
      )
      .join("");

    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(workflow.name)}</title>
<style>
body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #020617; color: #e5e7eb; padding: 24px; }
h1, h2, h3 { color: #facc15; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 12px; }
.layout { margin-top: 24px; display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 24px; align-items: flex-start; }
.node-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-top: 16px; }
.node-card { background: #020617; border: 1px solid #1f2937; border-radius: 10px; padding: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.35); }
.node-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
.node-type { font-size: 13px; font-weight: 600; text-transform: capitalize; color: #93c5fd; }
.node-id { font-size: 11px; color: #9ca3af; }
.meta { font-size: 11px; color: #e5e7eb; margin-bottom: 6px; }
.connections { font-size: 11px; color: #9ca3af; display: flex; flex-direction: column; gap: 2px; margin-top: 6px; }
.badge { display: inline-flex; align-items: center; padding: 2px 6px; border-radius: 999px; background: #111827; color: #e5e7eb; font-size: 10px; margin-right: 4px; margin-top: 2px; }
.muted { color: #4b5563; font-size: 10px; }
.section-title { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280; margin-right: 6px; }
.images { display: grid; grid-template-columns: repeat(auto-fit, minmax(80px, 1fr)); gap: 6px; margin-top: 8px; }
.image-frame { position: relative; background: #020617; border-radius: 6px; overflow: hidden; border: 1px solid #1f2937; padding-bottom: 4px; }
.image-frame img { display: block; width: 100%; height: 80px; object-fit: cover; border-bottom: 1px solid #1f2937; }
.image-download-button { display: block; width: calc(100% - 8px); margin: 4px auto 2px; text-align: center; font-size: 10px; padding: 3px 0; border-radius: 999px; border: 1px solid #1f2937; background: #0b1120; color: #e5e7eb; text-decoration: none; cursor: pointer; }
.image-download-button:hover { background: #111827; }
.image-more { display: flex; align-items: center; justify-content: center; font-size: 11px; color: #9ca3af; border-radius: 6px; border: 1px dashed #4b5563; }
.prompt-block { margin-top: 8px; font-size: 11px; line-height: 1.4; color: #e5e7eb; padding: 6px 8px; border-radius: 6px; background: #030712; border: 1px solid #1f2937; max-height: 120px; overflow: auto; }
.flow-list { margin-top: 8px; font-size: 11px; color: #e5e7eb; padding: 8px 10px; border-radius: 8px; background: #020617; border: 1px solid #1f2937; }
.flow-list ul { padding-left: 16px; margin: 4px 0 0; }
.flow-list li { margin: 2px 0; }
.json-block { margin-top: 16px; font-size: 11px; color: #e5e7eb; padding: 10px 12px; border-radius: 8px; background: #020617; border: 1px solid #1f2937; max-height: 360px; overflow: auto; }
</style>
</head>
<body>
<h1>Workflow: ${escapeHtml(workflow.name)}</h1>
<p>Edge style: <code>${escapeHtml(edgeStyle)}</code></p>
<div class="layout">
  <div>
    <h2>Nodes & Images</h2>
    <div class="node-grid">
      ${nodeCards}
    </div>
  </div>
  <div>
    <h2>Flow</h2>
    <div class="flow-list">
      <div class="section-title">Edges</div>
      <ul>
        ${edgeList}
      </ul>
    </div>
    <h3>Raw JSON</h3>
    <div class="json-block"><pre><code>${escapeHtml(json)}</code></pre></div>
  </div>
</div>
</body>
</html>`;

    const htmlBlob = new Blob([htmlContent], { type: "text/html" });
    const htmlUrl = URL.createObjectURL(htmlBlob);
    window.open(htmlUrl, "_blank", "noopener,noreferrer");
  },

  loadWorkflow: (workflow: WorkflowFile) => {
    // Update nodeIdCounter to avoid ID collisions
    const maxId = workflow.nodes.reduce((max, node) => {
      const match = node.id.match(/-(\d+)$/);
      if (match) {
        return Math.max(max, parseInt(match[1], 10));
      }
      return max;
    }, 0);
    nodeIdCounter = maxId;

    set({
      nodes: workflow.nodes,
      edges: workflow.edges,
      edgeStyle: workflow.edgeStyle || "angular",
      isRunning: false,
      currentNodeId: null,
    });
  },

  clearWorkflow: () => {
    set({
      nodes: [],
      edges: [],
      isRunning: false,
      currentNodeId: null,
    });
  },

  addToGlobalHistory: (item: Omit<ImageHistoryItem, "id">) => {
    const newItem: ImageHistoryItem = {
      ...item,
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    };

    set((state) => ({
      globalImageHistory: [newItem, ...state.globalImageHistory],
    }));
  },

  clearGlobalHistory: () => {
    set({ globalImageHistory: [] });
  },
}));
