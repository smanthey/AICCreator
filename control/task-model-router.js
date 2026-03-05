"use strict";

/**
 * control/task-model-router.js
 * 
 * Model Swap Logic - Task-to-Model Mapping
 * 
 * Problem: Running a 70B model for "Check if this file exists" is wasteful.
 * For zero-maintenance, we need Task-to-Model Mapping.
 * 
 * Solution: Router in Dispatcher that maps:
 * - Routine/Check tasks → phi-4 or llama-3.2-1b (Fast, low heat)
 * - Coding/Reasoning → qwen2.5-coder or deepseek-v3 (Heavy duty)
 * 
 * Why: Prevents GPU thermal throttling and ensures heavy tasks have resources.
 */

// Task type to model mapping
const TASK_MODEL_MAP = {
  // Routine/Check tasks - Use small, fast models
  "echo": "ollama_llama3_2_3b",
  "file_exists": "ollama_llama3_2_3b",
  "status_check": "ollama_llama3_2_3b",
  "health_check": "ollama_llama3_2_3b",
  "validate": "ollama_llama3_2_3b",
  "classify": "ollama_llama3_2_3b",
  "index": "ollama_llama3_2_3b",
  
  // Medium complexity - Use medium models
  "analyze": "ollama_qwen3_7b",
  "triage": "ollama_qwen3_7b",
  "plan": "ollama_qwen3_7b",
  "research": "ollama_qwen3_7b",
  "content": "ollama_qwen3_7b",
  
  // Heavy duty - Coding/Reasoning - Use large models
  "code": "ollama_qwen3_coder_30b",
  "coding": "ollama_qwen3_coder_30b",
  "saas_development": "ollama_qwen3_coder_30b",
  "repo_autofix": "ollama_qwen3_coder_30b",
  "orchestrate": "ollama_qwen3_14b",
  "reasoning": "ollama_qwen3_14b",
  "complex_analysis": "ollama_qwen3_14b",
};

// Model categories for resource management
const MODEL_CATEGORIES = {
  light: ["ollama_llama3_2_3b", "ollama_gemma_2b"],
  medium: ["ollama_qwen3_7b", "ollama_qwen3_4b"],
  heavy: ["ollama_qwen3_14b", "ollama_qwen3_coder_30b", "ollama_qwen3_32b"],
};

/**
 * Get recommended model for a task type
 */
function getModelForTask(taskType, opts = {}) {
  // Check for explicit override
  if (opts.force_model) {
    return opts.force_model;
  }
  
  // Check task type mapping
  const mappedModel = TASK_MODEL_MAP[taskType];
  if (mappedModel) {
    return mappedModel;
  }
  
  // Pattern matching for task types
  const taskLower = String(taskType || "").toLowerCase();
  
  // Check patterns
  if (taskLower.includes("code") || taskLower.includes("dev") || taskLower.includes("fix")) {
    return "ollama_qwen3_coder_30b";
  }
  
  if (taskLower.includes("analyze") || taskLower.includes("research") || taskLower.includes("plan")) {
    return "ollama_qwen3_7b";
  }
  
  if (taskLower.includes("check") || taskLower.includes("status") || taskLower.includes("validate")) {
    return "ollama_llama3_2_3b";
  }
  
  // Default to medium model
  return "ollama_qwen3_7b";
}

/**
 * Check if model is appropriate for task complexity
 */
function isModelAppropriate(modelKey, taskType, complexity = "medium") {
  const modelCategory = Object.entries(MODEL_CATEGORIES).find(([_, models]) => 
    models.includes(modelKey)
  )?.[0] || "medium";
  
  const complexityMap = {
    light: ["light"],
    medium: ["light", "medium"],
    heavy: ["light", "medium", "heavy"],
  };
  
  return complexityMap[complexity]?.includes(modelCategory) || false;
}

/**
 * Suggest model downgrade if task is too simple
 */
function suggestModelDowngrade(currentModel, taskType) {
  const suggested = getModelForTask(taskType);
  
  if (suggested !== currentModel) {
    const currentCategory = Object.entries(MODEL_CATEGORIES).find(([_, models]) => 
      models.includes(currentModel)
    )?.[0];
    
    const suggestedCategory = Object.entries(MODEL_CATEGORIES).find(([_, models]) => 
      models.includes(suggested)
    )?.[0];
    
    // Only suggest if downgrading (heavy -> medium -> light)
    if (
      (currentCategory === "heavy" && suggestedCategory !== "heavy") ||
      (currentCategory === "medium" && suggestedCategory === "light")
    ) {
      return {
        should_downgrade: true,
        current_model: currentModel,
        suggested_model: suggested,
        reason: `Task "${taskType}" is better suited for ${suggested}`,
      };
    }
  }
  
  return {
    should_downgrade: false,
    current_model: currentModel,
  };
}

module.exports = {
  getModelForTask,
  isModelAppropriate,
  suggestModelDowngrade,
  TASK_MODEL_MAP,
  MODEL_CATEGORIES,
};
