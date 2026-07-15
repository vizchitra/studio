<script lang="ts">
  export let kind: "error" | "success" | undefined = undefined;
</script>

<div class="content-notice" class:notice-error={kind === "error"} class:notice-success={kind === "success"}>
  <slot />
</div>
