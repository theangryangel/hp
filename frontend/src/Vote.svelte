<script>
		export let person;

		import confetti from 'canvas-confetti';
		import {mp3, ogg} from 'fart';
		import {Howl} from 'howler';

		function upvote(e, id) {
				fetch(`/users/${id}/reward`, {method: "POST"}).then(r => r.json()).then(points => {
						person = points;
					});

				confetti({
						particleCount: 100,
						startVelocity: 30,
						spread: 360,
					})
		}

		function downvote(e, id) {
				fetch(`/users/${id}/reward?quantity=-1`, {method: "POST"}).then(r => r.json()).then(points => {
						person = points;
					});

				const mp3Idx = Math.floor(Math.random() * mp3.sound.length)
				const oggIdx = Math.floor(Math.random() * ogg.sound.length)

				const sound = new Howl({ src: [
						mp3.prefix + mp3.sound[mp3Idx],
						ogg.prefix + ogg.sound[oggIdx]
					]});

				sound.play();
			}
</script>

<div class="flex flex-row mt-5 mb-5 items-center">
	<div class="m-3">
		<button on:click="{(e) => {upvote(e, person.id)}}"
						class="w-32 bg-white tracking-wide text-gray-800 font-bold rounded border-b-2 border-green-500 hover:border-green-600 hover:bg-green-500 hover:text-white shadow-md py-2 px-6 inline-flex items-center">
						<span class="mx-auto">+1</span>
		</button>
	</div>

	<div class="m-3 flex-grow text-center" style="">
		{person.name} ({person.points})
	</div>

	<div class="m-3">
		<button on:click="{(e) => {downvote(e, person.id)}}"
						class="w-32 bg-white tracking-wide text-gray-800 font-bold rounded border-b-2 border-red-500 hover:border-red-600 hover:bg-red-500 hover:text-white shadow-md py-2 px-6 inline-flex items-center">
						<span class="mx-auto">-1</span>
		</button>
	</div>
</div>
