<script lang="ts">
  // Two widths, not one: prose (48rem, for forms/text) or wide (80rem, for
  // data grids/tables) — see UI_PRINCIPLES.md, Container.
  export let wide = false;
</script>

<div class={wide ? "wide-container" : "content-container"}>
  <slot />
</div>
