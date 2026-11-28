<script setup>
import { ref, shallowRef } from 'vue';
import { YsmViewer } from '@lemwood/ysm-threejs-engine/vue';

const viewer = ref(null);
const file = shallowRef(null);
const animation = ref('idle');
const paused = ref(false);
const clips = ref([]);
const warnings = ref([]);
function selectFile(event) { file.value = event.target.files?.[0] ?? null; }
function loaded(model) {
  clips.value = model.animations;
  animation.value = clips.value.includes('idle') ? 'idle' : clips.value[0] ?? null;
}
</script>

<template>
  <main>
    <h1>YSM · Vue 3</h1>
    <p>选择本地 .ysm 或 .zip 模型，文件仅在浏览器中解析。</p>
    <input type="file" accept=".ysm,.zip" @change="selectFile" />
    <label>动画 <select v-model="animation"><option :value="null">停止</option><option v-for="clip in clips" :key="clip" :value="clip">{{ clip }}</option></select></label>
    <label><input v-model="paused" type="checkbox" /> 暂停</label>
    <button @click="viewer?.setCameraPreset('front')">正面</button>
    <YsmViewer ref="viewer" :source="file" :animation="animation" :paused="paused"
      :query="{ ground_speed: 0.8, is_on_ground: 1 }" :style="{ height: '520px' }"
      @load="loaded" @warnings="warnings = $event">
      <template #loading>正在加载模型…</template>
      <template #error="{ error }">加载失败：{{ error.message }}</template>
    </YsmViewer>
    <p v-if="warnings.length">表达式兼容修复：{{ warnings.length }} 项</p>
  </main>
</template>

<style>
body { margin: 0; background: #11141b; color: #e2e8f0; font-family: system-ui, sans-serif; }
main { max-width: 1100px; margin: 32px auto; padding: 0 20px; }
label, button { margin: 12px; }
select { max-width: 280px; }
</style>
