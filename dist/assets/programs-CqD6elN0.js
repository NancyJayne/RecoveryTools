function t(){const e=document.getElementById("programsSection");e&&(e.classList.add("active"),e.innerHTML=`
    <div class="text-center py-10">
      <h2 class="text-2xl font-bold text-white mb-4">Programs Coming Soon</h2>
      <p class="text-gray-400">We're working on self-guided rehab, mobility and recovery plans.</p>
    </div>
  `,e.scrollIntoView({behavior:"smooth"}))}export{t as initProgramsPage};
