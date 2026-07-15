<script lang="ts">
  // The auto-fill minmax reflow pattern already used for the asset gallery —
  // reflows by available width rather than a fixed column count.
  export let min = "220px";
  export let gap = "var(--space-flow-0)";
</script>

<div class="ui-grid" style:gap style:--ui-grid-min={min}>
  <slot />
</div>

<style>
  .ui-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(var(--ui-grid-min), 1fr));
  }
</style>
