<script lang="ts">
  // Consistent vertical rhythm — a flex column with one gap value, instead
  // of each route hand-rolling `flex-direction: column; gap: ...`.
  export let gap = "var(--space-flow--2)";
</script>

<div class="ui-stack" style:gap>
  <slot />
</div>

<style>
  .ui-stack {
    display: flex;
    flex-direction: column;
  }
</style>
