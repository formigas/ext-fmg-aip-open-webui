<script lang="ts">
	import { getContext } from 'svelte';
	import { marked } from 'marked';
	import { toast } from 'svelte-sonner';
	import { tick, onMount } from 'svelte';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import Check from '$lib/components/icons/Check.svelte';
	import { sanitizeResponseContent } from '$lib/utils';
	import { user, MODEL_DOWNLOAD_POOL, mobile, settings, config, models } from '$lib/stores';
	import { deleteModel, pullModel, getOllamaVersion } from '$lib/apis/ollama';
	import { getModels } from '$lib/apis';

	// Get i18n from context properly
	const i18n = getContext<{ t: (key: string, params?: Record<string, string>) => string }>('i18n');

	// Define Model interface
	interface Model {
		name?: string;
		tags?: Array<{ name: string }>;
		owned_by?: string;
		direct?: boolean;
		info?: {
			meta?: {
				hidden?: boolean;
				description?: string;
				profile_image_url?: string;
			};
		};
		ollama?: {
			details?: {
				parameter_size?: string;
				quantization_level?: string;
			};
			size?: number;
		};
	}

	// Required props from parent
	export let items: {
		label: string;
		value: string;
		model: Model;
		[key: string]: any;
	}[] = [];
	export let value: string = '';
	export let searchValue: string = '';
	export let show: boolean = false;

	// Event for updating the selected value in parent
	export let onSelect = (newValue: string) => {};

	// Internal state (now managed here instead of parent)
	let tags: string[] = [];
	let selectedTag = '';
	let selectedConnectionType = '';
	let selectedModelIdx = 0;
	let tagsContainerElement: HTMLElement;
	let ollamaVersion: any = null;
	let filteredItems: typeof items = [];

	$: {
		// Filter items based on search, tags, and connection type
		filteredItems = items.filter((item) => {
			// Search filter
			if (
				searchValue &&
				!item.value.toLowerCase().includes(searchValue.toLowerCase()) &&
				!item.label.toLowerCase().includes(searchValue.toLowerCase()) &&
				!(item.model?.tags ?? []).some((tag: { name: string }) =>
					tag.name.toLowerCase().includes(searchValue.toLowerCase())
				)
			) {
				return false;
			}

			// Tag filter
			if (
				selectedTag !== '' &&
				!(item.model?.tags ?? []).map((tag: { name: string }) => tag.name).includes(selectedTag)
			) {
				return false;
			}

			// Connection type filter
			if (selectedConnectionType === 'ollama' && item.model?.owned_by !== 'ollama') {
				return false;
			} else if (selectedConnectionType === 'openai' && item.model?.owned_by !== 'openai') {
				return false;
			} else if (selectedConnectionType === 'direct' && !item.model?.direct) {
				return false;
			}

			// Hide hidden models
			return !(item.model?.info?.meta?.hidden ?? false);
		});

		resetView();
	}

	async function resetView() {
		await tick();

		const selectedInFiltered = filteredItems.findIndex((item) => item.value === value);

		if (selectedInFiltered >= 0) {
			// The selected model is visible in the current filter
			selectedModelIdx = selectedInFiltered;
		} else {
			// The selected model is not visible, default to first item in filtered list
			selectedModelIdx = 0;
		}

		await tick();
		const item = document.querySelector(`[data-arrow-selected="true"]`);
		item?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
	}

	async function pullModelHandler() {
		const sanitizedModelTag = searchValue.trim().replace(/^ollama\s+(run|pull)\s+/, '');

		interface ModelDownloadItem {
			abortController?: AbortController;
			reader?: ReadableStreamDefaultReader<string>;
			done?: boolean;
			pullProgress?: number;
			digest?: string;
		}

		interface ModelDownloadPool {
			[key: string]: ModelDownloadItem;
		}

		if (($MODEL_DOWNLOAD_POOL as ModelDownloadPool)[sanitizedModelTag]) {
			toast.error(
				$i18n.t(`Model '{{modelTag}}' is already in queue for downloading.`, {
					modelTag: sanitizedModelTag
				})
			);
			return;
		}
		if (Object.keys($MODEL_DOWNLOAD_POOL).length === 3) {
			toast.error(
				$i18n.t('Maximum of 3 models can be downloaded simultaneously. Please try again later.')
			);
			return;
		}

		try {
			const result = await pullModel(localStorage.token, sanitizedModelTag, '0').catch((error) => {
				toast.error(`${error}`);
				return null;
			});

			if (!result) return;

			const [res, controller] = result;

			if (res) {
				const reader = res.body
					.pipeThrough(new TextDecoderStream())
					.pipeThrough(splitStream('\n'))
					.getReader();

				const downloadPool = $MODEL_DOWNLOAD_POOL as ModelDownloadPool;

				MODEL_DOWNLOAD_POOL.set({
					...downloadPool,
					[sanitizedModelTag]: {
						...downloadPool[sanitizedModelTag],
						abortController: controller,
						reader,
						done: false
					}
				});

				while (true) {
					try {
						const { value: streamValue, done } = await reader.read();
						if (done) break;

						let lines = streamValue.split('\n');

						for (const line of lines) {
							if (line !== '') {
								let data = JSON.parse(line);
								console.log(data);
								if (data.error) {
									throw data.error;
								}
								if (data.detail) {
									throw data.detail;
								}

								if (data.status) {
									if (data.digest) {
										let downloadProgress = 0;
										if (data.completed) {
											downloadProgress = Math.round((data.completed / data.total) * 1000) / 10;
										} else {
											downloadProgress = 100;
										}

										const currPool = $MODEL_DOWNLOAD_POOL as ModelDownloadPool;
										MODEL_DOWNLOAD_POOL.set({
											...currPool,
											[sanitizedModelTag]: {
												...currPool[sanitizedModelTag],
												pullProgress: downloadProgress,
												digest: data.digest
											}
										});
									} else {
										toast.success(data.status);

										const currPool = $MODEL_DOWNLOAD_POOL as ModelDownloadPool;
										MODEL_DOWNLOAD_POOL.set({
											...currPool,
											[sanitizedModelTag]: {
												...currPool[sanitizedModelTag],
												done: data.status === 'success'
											}
										});
									}
								}
							}
						}
					} catch (error: any) {
						console.log(error);
						const errorMessage = typeof error === 'string' ? error : error.message || String(error);
						toast.error(errorMessage);
						break;
					}
				}

				const finalPool = $MODEL_DOWNLOAD_POOL as ModelDownloadPool;
				if (finalPool[sanitizedModelTag]?.done) {
					toast.success(
						$i18n.t(`Model '{{modelName}}' has been successfully downloaded.`, {
							modelName: sanitizedModelTag
						})
					);

					// Since the config and settings properties may not exist in the actual type
					// and we're operating based on runtime values, we need to use any here
					const enableDirectConnections =
						($config as any)?.features?.enable_direct_connections &&
						($settings as any)?.directConnections;

					models.set(await getModels(localStorage.token, enableDirectConnections));
				} else {
					toast.error($i18n.t('Download canceled'));
				}

				const updatedPool = { ...$MODEL_DOWNLOAD_POOL } as ModelDownloadPool;
				delete updatedPool[sanitizedModelTag];

				MODEL_DOWNLOAD_POOL.set(updatedPool);
			}
		} catch (error) {
			console.error('Error in pullModelHandler:', error);
		}
	}

	async function cancelModelPullHandler(model: string) {
		interface ModelDownloadItem {
			reader?: ReadableStreamDefaultReader<string>;
			abortController?: AbortController;
		}

		interface ModelDownloadPool {
			[key: string]: ModelDownloadItem;
		}

		const downloadPool = $MODEL_DOWNLOAD_POOL as ModelDownloadPool;
		const { reader, abortController } = downloadPool[model] || {};

		if (abortController) {
			abortController.abort();
		}
		if (reader) {
			await reader.cancel();
			const updatedPool = { ...$MODEL_DOWNLOAD_POOL } as ModelDownloadPool;
			delete updatedPool[model];

			MODEL_DOWNLOAD_POOL.set(updatedPool);
			await deleteModel(localStorage.token, model);
			toast.success(`${model} download has been canceled`);
		}
	}

	// Function to split stream by separator
	function splitStream(separator: string): TransformStream<string, string> {
		let buffer = '';
		return new TransformStream({
			transform(chunk: string, controller: TransformStreamDefaultController<string>) {
				buffer += chunk;
				const parts = buffer.split(separator);
				parts.slice(0, -1).forEach((part) => controller.enqueue(part));
				buffer = parts[parts.length - 1];
			},
			flush(controller: TransformStreamDefaultController<string>) {
				if (buffer) controller.enqueue(buffer);
			}
		});
	}

	// Initialize tags and get Ollama version on mount
	onMount(async () => {
		ollamaVersion = await getOllamaVersion(localStorage.token).catch((error) => false);

		if (items) {
			tags = items
				.filter((item) => !(item.model?.info?.meta?.hidden ?? false))
				.flatMap((item) => item.model?.tags ?? [])
				.map((tag: { name: string }) => tag.name);

			// Remove duplicates and sort
			tags = Array.from(new Set(tags)).sort((a, b) => a.localeCompare(b));
		}

		resetView();
	});

	// Handle keyboard navigation
	export function handleKeyboardNavigation(e: KeyboardEvent): boolean {
		if (e.code === 'Enter' && filteredItems.length > 0) {
			onSelect(filteredItems[selectedModelIdx].value);
			return true; // handled
		} else if (e.code === 'ArrowDown') {
			selectedModelIdx = Math.min(selectedModelIdx + 1, filteredItems.length - 1);
		} else if (e.code === 'ArrowUp') {
			selectedModelIdx = Math.max(selectedModelIdx - 1, 0);
		} else {
			// if the user types something, reset to the top selection.
			selectedModelIdx = 0;
		}

		const item = document.querySelector(`[data-arrow-selected="true"]`);
		item?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
		return false; // not fully handled
	}
</script>

<div class="px-3 max-h-64 overflow-y-auto scrollbar-hidden group relative">
	{#if tags && items.filter((item) => !(item.model?.info?.meta?.hidden ?? false)).length > 0}
		<div
			class="flex w-full sticky top-0 z-10 bg-white dark:bg-gray-850 overflow-x-auto scrollbar-none"
			on:wheel={(e) => {
				if (e.deltaY !== 0) {
					e.preventDefault();
					e.currentTarget.scrollLeft += e.deltaY;
				}
			}}
		>
			<div
				class="flex gap-1 w-fit text-center text-sm font-medium rounded-full bg-transparent px-1.5 pb-0.5"
				bind:this={tagsContainerElement}
			>
				{#if (items.find((item) => item.model?.owned_by === 'ollama') && items.find((item) => item.model?.owned_by === 'openai')) || items.find((item) => item.model?.direct) || tags.length > 0}
					<button
						class="min-w-fit outline-none p-1.5 {selectedTag === '' && selectedConnectionType === ''
							? ''
							: 'text-gray-300 dark:text-gray-600 hover:text-gray-700 dark:hover:text-white'} transition capitalize"
						on:click={() => {
							selectedConnectionType = '';
							selectedTag = '';
						}}
					>
						{$i18n.t('All')}
					</button>
				{/if}

				{#if items.find((item) => item.model?.owned_by === 'ollama') && items.find((item) => item.model?.owned_by === 'openai')}
					<button
						class="min-w-fit outline-none p-1.5 {selectedConnectionType === 'ollama'
							? ''
							: 'text-gray-300 dark:text-gray-600 hover:text-gray-700 dark:hover:text-white'} transition capitalize"
						on:click={() => {
							selectedTag = '';
							selectedConnectionType = 'ollama';
						}}
					>
						{$i18n.t('Local')}
					</button>
					<button
						class="min-w-fit outline-none p-1.5 {selectedConnectionType === 'openai'
							? ''
							: 'text-gray-300 dark:text-gray-600 hover:text-gray-700 dark:hover:text-white'} transition capitalize"
						on:click={() => {
							selectedTag = '';
							selectedConnectionType = 'openai';
						}}
					>
						{$i18n.t('External')}
					</button>
				{/if}

				{#if items.find((item) => item.model?.direct)}
					<button
						class="min-w-fit outline-none p-1.5 {selectedConnectionType === 'direct'
							? ''
							: 'text-gray-300 dark:text-gray-600 hover:text-gray-700 dark:hover:text-white'} transition capitalize"
						on:click={() => {
							selectedTag = '';
							selectedConnectionType = 'direct';
						}}
					>
						{$i18n.t('Direct')}
					</button>
				{/if}

				{#each tags as tag}
					<button
						class="min-w-fit outline-none p-1.5 {selectedTag === tag
							? ''
							: 'text-gray-300 dark:text-gray-600 hover:text-gray-700 dark:hover:text-white'} transition capitalize"
						on:click={() => {
							selectedConnectionType = '';
							selectedTag = tag;
						}}
					>
						{tag}
					</button>
				{/each}
			</div>
		</div>
	{/if}

	{#each filteredItems as item, index}
		<button
			aria-label="model-item"
			class="flex w-full text-left font-medium line-clamp-1 select-none items-center rounded-button py-2 pl-3 pr-1.5 text-sm text-gray-700 dark:text-gray-100 outline-hidden transition-all duration-75 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg cursor-pointer data-highlighted:bg-muted {index ===
			selectedModelIdx
				? 'bg-gray-100 dark:bg-gray-800 group-hover:bg-transparent'
				: ''}"
			data-arrow-selected={index === selectedModelIdx}
			data-value={item.value}
			on:click={() => {
				onSelect(item.value);
				show = false;
			}}
		>
			<div class="flex flex-col">
				{#if $mobile && (item?.model?.tags ?? []).length > 0}
					<div class="flex gap-0.5 self-start h-full mb-1.5 -translate-x-1">
						{#each item.model?.tags.sort((a, b) => a.name.localeCompare(b.name)) as tag}
							<div
								class="text-xs font-bold px-1 rounded-sm uppercase line-clamp-1 bg-gray-500/20 text-gray-700 dark:text-gray-200"
							>
								{tag.name}
							</div>
						{/each}
					</div>
				{/if}
				<div class="flex items-center gap-2">
					<div class="flex items-center min-w-fit">
						<div class="line-clamp-1">
							<div class="flex items-center min-w-fit">
								<Tooltip
									content={$user?.role === 'admin' ? (item?.value ?? '') : ''}
									placement="top-start"
								>
									<img
										src={item.model?.info?.meta?.profile_image_url ?? '/static/favicon.png'}
										alt="Model"
										class="rounded-full size-5 flex items-center mr-2"
									/>

									<div class="flex items-center line-clamp-1">
										<div class="line-clamp-1">
											{item.label}
										</div>

										{#if item.model.owned_by === 'ollama' && (item.model.ollama?.details?.parameter_size ?? '') !== ''}
											<div class="flex ml-1 items-center translate-y-[0.5px]">
												<Tooltip
													content={`${
														item.model.ollama?.details?.quantization_level
															? item.model.ollama?.details?.quantization_level + ' '
															: ''
													}${
														item.model.ollama?.size
															? `(${(item.model.ollama?.size / 1024 ** 3).toFixed(1)}GB)`
															: ''
													}`}
													className="self-end"
												>
													<span
														class="text-xs font-medium text-gray-600 dark:text-gray-400 line-clamp-1"
														>{item.model.ollama?.details?.parameter_size ?? ''}</span
													>
												</Tooltip>
											</div>
										{/if}
									</div>
								</Tooltip>
							</div>
						</div>
					</div>

					{#if item.model?.direct}
						<Tooltip content={`${'Direct'}`}>
							<div class="translate-y-[1px]">
								<svg
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 16 16"
									fill="currentColor"
									class="size-3"
								>
									<path
										fill-rule="evenodd"
										d="M2 2.75A.75.75 0 0 1 2.75 2C8.963 2 14 7.037 14 13.25a.75.75 0 0 1-1.5 0c0-5.385-4.365-9.75-9.75-9.75A.75.75 0 0 1 2 2.75Zm0 4.5a.75.75 0 0 1 .75-.75 6.75 6.75 0 0 1 6.75 6.75.75.75 0 0 1-1.5 0C8 10.35 5.65 8 2.75 8A.75.75 0 0 1 2 7.25ZM3.5 11a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z"
										clip-rule="evenodd"
									/>
								</svg>
							</div>
						</Tooltip>
					{:else if item.model.owned_by === 'openai'}
						<Tooltip content={`${'External'}`}>
							<div class="translate-y-[1px]">
								<svg
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 16 16"
									fill="currentColor"
									class="size-3"
								>
									<path
										fill-rule="evenodd"
										d="M8.914 6.025a.75.75 0 0 1 1.06 0 3.5 3.5 0 0 1 0 4.95l-2 2a3.5 3.5 0 0 1-5.396-4.402.75.75 0 0 1 1.251.827 2 2 0 0 0 3.085 2.514l2-2a2 2 0 0 0 0-2.828.75.75 0 0 1 0-1.06Z"
										clip-rule="evenodd"
									/>
									<path
										fill-rule="evenodd"
										d="M7.086 9.975a.75.75 0 0 1-1.06 0 3.5 3.5 0 0 1 0-4.95l2-2a3.5 3.5 0 0 1 5.396 4.402.75.75 0 0 1-1.251-.827 2 2 0 0 0-3.085-2.514l-2 2a2 2 0 0 0 0 2.828.75.75 0 0 1 0 1.06Z"
										clip-rule="evenodd"
									/>
								</svg>
							</div>
						</Tooltip>
					{/if}

					{#if item.model?.info?.meta?.description}
						<Tooltip
							content={`${marked.parse(
								sanitizeResponseContent(item.model?.info?.meta?.description).replaceAll(
									'\n',
									'<br>'
								)
							)}`}
						>
							<div class="translate-y-[1px]">
								<svg
									xmlns="http://www.w3.org/2000/svg"
									fill="none"
									viewBox="0 0 24 24"
									stroke-width="1.5"
									stroke="currentColor"
									class="w-4 h-4"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z"
									/>
								</svg>
							</div>
						</Tooltip>
					{/if}

					{#if !$mobile && (item?.model?.tags ?? []).length > 0}
						<div
							class="flex gap-0.5 self-center items-center h-full translate-y-[0.5px] overflow-x-auto scrollbar-none"
						>
							{#each item.model?.tags.sort((a, b) => a.name.localeCompare(b.name)) as tag}
								<Tooltip content={tag.name} className="flex-shrink-0">
									<div
										class="text-xs font-bold px-1 rounded-sm uppercase bg-gray-500/20 text-gray-700 dark:text-gray-200"
									>
										{tag.name}
									</div>
								</Tooltip>
							{/each}
						</div>
					{/if}
				</div>
			</div>

			{#if value === item.value}
				<div class="ml-auto pl-2 pr-2 md:pr-0">
					<Check />
				</div>
			{/if}
		</button>
	{:else}
		<div class="">
			<div class="block px-3 py-2 text-sm text-gray-700 dark:text-gray-100">
				{$i18n.t('No results found')}
			</div>
		</div>
	{/each}

	{#if !(searchValue.trim() in $MODEL_DOWNLOAD_POOL) && searchValue && ollamaVersion && $user?.role === 'admin'}
		<Tooltip
			content={$i18n.t(`Pull "{{searchValue}}" from Ollama.com`, {
				searchValue: searchValue
			})}
			placement="top-start"
		>
			<button
				class="flex w-full font-medium line-clamp-1 select-none items-center rounded-button py-2 pl-3 pr-1.5 text-sm text-gray-700 dark:text-gray-100 outline-hidden transition-all duration-75 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg cursor-pointer data-highlighted:bg-muted"
				on:click={pullModelHandler}
			>
				<div class="truncate">
					{$i18n.t(`Pull "{{searchValue}}" from Ollama.com`, { searchValue: searchValue })}
				</div>
			</button>
		</Tooltip>
	{/if}

	{#each Object.keys($MODEL_DOWNLOAD_POOL) as model}
		<div
			class="flex w-full justify-between font-medium select-none rounded-button py-2 pl-3 pr-1.5 text-sm text-gray-700 dark:text-gray-100 outline-hidden transition-all duration-75 rounded-lg cursor-pointer data-highlighted:bg-muted"
		>
			<div class="flex">
				<div class="-ml-2 mr-2.5 translate-y-0.5">
					<svg
						class="size-4"
						viewBox="0 0 24 24"
						fill="currentColor"
						xmlns="http://www.w3.org/2000/svg"
						><style>
							.spinner_ajPY {
								transform-origin: center;
								animation: spinner_AtaB 0.75s infinite linear;
							}
							@keyframes spinner_AtaB {
								100% {
									transform: rotate(360deg);
								}
							}
						</style><path
							d="M12,1A11,11,0,1,0,23,12,11,11,0,0,0,12,1Zm0,19a8,8,0,1,1,8-8A8,8,0,0,1,12,20Z"
							opacity=".25"
						/><path
							d="M10.14,1.16a11,11,0,0,0-9,8.92A1.59,1.59,0,0,0,2.46,12,1.52,1.52,0,0,0,4.11,10.7a8,8,0,0,1,6.66-6.61A1.42,1.42,0,0,0,12,2.69h0A1.57,1.57,0,0,0,10.14,1.16Z"
							class="spinner_ajPY"
						/></svg
					>
				</div>

				<div class="flex flex-col self-start">
					<div class="flex gap-1">
						<div class="line-clamp-1">
							Downloading "{model}"
						</div>

						<div class="shrink-0">
							{'pullProgress' in $MODEL_DOWNLOAD_POOL[model]
								? `(${$MODEL_DOWNLOAD_POOL[model].pullProgress}%)`
								: ''}
						</div>
					</div>

					{#if 'digest' in $MODEL_DOWNLOAD_POOL[model] && $MODEL_DOWNLOAD_POOL[model].digest}
						<div class="-mt-1 h-fit text-[0.7rem] dark:text-gray-500 line-clamp-1">
							{$MODEL_DOWNLOAD_POOL[model].digest}
						</div>
					{/if}
				</div>
			</div>

			<div class="mr-2 ml-1 translate-y-0.5">
				<Tooltip content={$i18n.t('Cancel')}>
					<button
						class="text-gray-800 dark:text-gray-100"
						on:click={() => cancelModelPullHandler(model)}
					>
						<svg
							class="w-4 h-4 text-gray-800 dark:text-white"
							aria-hidden="true"
							xmlns="http://www.w3.org/2000/svg"
							width="24"
							height="24"
							fill="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke="currentColor"
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M6 18 17.94 6M18 18 6.06 6"
							/>
						</svg>
					</button>
				</Tooltip>
			</div>
		</div>
	{/each}
</div>
