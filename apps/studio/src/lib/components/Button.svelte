<script lang="ts">
  // Buttons were bare reset styling (transparent background, cursor:
  // pointer) — clickable text, not visually buttons, undercutting the
  // "consequential actions are plain, labeled buttons" principle. Variants
  // carry visible weight: primary for Approve/Publish, danger for
  // Reject, tertiary for lower-stakes actions (Reprocess, Confirm).
  export let variant: "primary" | "danger" | "tertiary" = "tertiary";
  export let type: "submit" | "button" | "reset" = "submit";
</script>

<button {type} class="ui-button ui-button--{variant}" on:click {...$$restProps}>
  <slot />
</button>

<style>
  .ui-button {
    border: 1px solid var(--color-border);
    border-radius: 0.375rem;
    padding: 0.4rem 0.9rem;
    font-size: 0.9rem;
    background: var(--color-surface);
  }

  .ui-button--primary {
    background: var(--color-viz-teal-solid);
    border-color: var(--color-viz-teal-solid);
    color: white;
  }

  .ui-button--danger {
    background: var(--color-error);
    border-color: var(--color-error);
    color: white;
  }

  .ui-button--tertiary {
    background: transparent;
  }
</style>
