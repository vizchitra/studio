<div class="ui-card">
  <slot />
</div>

<style>
  .ui-card {
    border: 1px solid var(--color-border);
    border-radius: 0.5rem;
    overflow: hidden;
    background: var(--color-surface);
    display: flex;
    flex-direction: column;
  }
</style>
