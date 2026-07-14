<script lang="ts">
  import type { PageData } from "./$types";
  export let data: PageData;
</script>

<h1>VizChitra Studio</h1>
<p>Signed in as {data.user?.email ?? "unknown"}</p>
