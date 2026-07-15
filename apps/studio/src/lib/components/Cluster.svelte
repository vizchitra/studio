<script lang="ts">
  // Wrapping inline groups with a consistent gap — tag lists, button rows.
  // Distinct from Grid: this sizes to content, Grid reflows a wall of cards.
  export let gap = "0.5rem";
</script>

<div class="ui-cluster" style:gap>
  <slot />
</div>

<style>
  .ui-cluster {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
  }
</style>
