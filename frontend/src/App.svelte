<script>
	let points = [];
	import Vote from './Vote.svelte';

	import { onMount } from 'svelte';
	onMount(async () => {
			points = await fetch(`/users`).then(r => r.json()).then(points => {
			return points.items;
		});
	});
</script>

<style global>
  /* purgecss start ignore */
  @tailwind base;
  @tailwind components;
  /* purgecss end ignore */
  @tailwind utilities;

	h1 {
		color: #ff3e00;
		text-transform: uppercase;
		font-size: 4em;
		font-weight: 100;
	}
</style>

<main class="h-screen flex flex-col max-w-sm items-center m-auto text-center justify-center">

	<h1>Hello You</h1>
	<ul>
		{#each points as i}
			<li class="border-b border-gray-200 last:border-b-0">
				<Vote person="{i}"/>
			</li>
		{/each}
	</ul>

</main>
