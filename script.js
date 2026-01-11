const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const GRAVITY = 0.5;
const FRICTION = 0.8;
const JUMP_FORCE = 15;
const DASH_COOLDOWN_TIME = 60;

const WORLD_WIDTH = 4000;
const WORLD_HEIGHT = 2500;

const SPAWN_POINTS = [
  { x: 100, y: 2450 },
  { x: 3850, y: 2450 },
  { x: 2000, y: 1150 },
  { x: 1000, y: 450 },
  { x: 2900, y: 450 },
];

const WEAPONS = {
  1: {
    name: "Desert Eagle",
    damage: 34,
    ammo: 7,
    maxAmmo: 7,
    reserve: 23,
    maxReserve: 23,
    rate: 25,
    speed: 38,
    spread: 0.02,
  },
  2: {
    name: "AK-47",
    damage: 16,
    ammo: 30,
    maxAmmo: 30,
    reserve: 90,
    maxReserve: 90,
    rate: 7,
    speed: 35,
    spread: 0.08,
  },
  3: {
    name: "AWP",
    damage: 110,
    ammo: 1,
    maxAmmo: 1,
    reserve: 10,
    maxReserve: 10,
    rate: 60,
    speed: 0,
    spread: 0,
  },
};

let keys = {};
let mouse = { x: 0, y: 0, left: false, right: false };
let player,
  platforms = [],
  bullets = [];
let camera = { x: 0, y: 0, zoom: 1, targetZoom: 1 };
let myNickname = "Player";
let remotePlayers = {};

// --- СИСТЕМА КИЛЛФИДА ---
function addKill(killer, victim) {
  const feed = document.getElementById("killfeed");
  if (!feed) return;
  const item = document.createElement("div");
  item.className = "kill-item";
  item.innerHTML = `<span style="color:#3498db">${killer}</span> ➔ <span style="color:#e74c3c">${victim}</span>`;
  feed.appendChild(item);
  setTimeout(() => item.remove(), 4000);
}

// Глобальная функция нанесения урона (чтобы работала везде)
function dealDamage(targetId, damage) {
  const { ref, set } = window.fbOps;
  let target = remotePlayers[targetId];
  if (target) {
    let newHp = target.health - damage;
    set(ref(window.db, `players/${targetId}/health`), newHp);
    if (newHp <= 0) addKill(myNickname, target.nickname);
  }
}

class Player {
  constructor() {
    this.w = 30;
    this.h = 45;
    this.reset();
  }

  reset() {
    const spawn = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
    this.x = spawn.x;
    this.y = spawn.y - this.h;
    this.velX = 0;
    this.velY = 0;
    this.grounded = false;
    this.jumps = 0;
    this.health = 100;
    this.weaponKey = 2;
    this.fireTimer = 0;
    this.isReloading = false;
    this.dashCooldown = 0;
    this.dashTimer = 0;
    this.afterimages = [];
    this.onWall = 0;
    this.restoreAmmo();
  }

  restoreAmmo() {
    Object.keys(WEAPONS).forEach((key) => {
      WEAPONS[key].ammo = WEAPONS[key].maxAmmo;
      WEAPONS[key].reserve = WEAPONS[key].maxReserve;
    });
  }

  update() {
    let w = WEAPONS[this.weaponKey];
    [1, 2, 3].forEach((n) => {
      if (keys["Digit" + n]) this.weaponKey = n;
    });

    if (this.dashTimer > 0) {
      this.dashTimer--;
      this.velY = 0;
      this.afterimages.push({ x: this.x, y: this.y, opacity: 0.7 });
      let steps = 5;
      for (let i = 0; i < steps; i++) {
        this.x += this.velX / steps;
        this.checkCollisions(true);
      }
    } else {
      if (keys["KeyA"]) this.velX = -10;
      if (keys["KeyD"]) this.velX = 10;
      this.velY += this.onWall !== 0 && this.velY > 0 ? 0 : GRAVITY;
      if (this.onWall !== 0 && this.velY > 2) this.velY = 2;
      this.x += this.velX;
      this.checkCollisions(true);
      this.y += this.velY;
      this.checkCollisions(false);
      this.velX *= FRICTION;
    }

    if (!(keys["KeyW"] || keys["Space"])) {
      this.jumpKeyReleased = true; // Клавиша отпущена
    }

    if ((keys["KeyW"] || keys["Space"]) && this.jumpKeyReleased) {
      if (this.grounded) {
        this.velY = -JUMP_FORCE;
        this.grounded = false;
        this.jumps = 1;
        this.jumpKeyReleased = false; // Блокируем до следующего нажатия
      } else if (this.onWall !== 0) {
        this.velY = -JUMP_FORCE;
        this.velX = -this.onWall * 10;
        this.jumps = 1;
        this.jumpKeyReleased = false;
      } else if (this.jumps === 1) {
        this.velY = -JUMP_FORCE * 0.8;
        this.jumps = 2;
        this.jumpKeyReleased = false;
      }
    }

    if (this.dashCooldown > 0) this.dashCooldown--;
    this.afterimages.forEach((img, i) => {
      img.opacity -= 0.05;
      if (img.opacity <= 0) this.afterimages.splice(i, 1);
    });

    if (this.fireTimer > 0) this.fireTimer--;
    if (mouse.left && this.fireTimer <= 0 && w.ammo > 0 && !this.isReloading)
      this.shoot();
    if (w.ammo <= 0 && w.reserve > 0 && !this.isReloading) this.reload();

    this.updateUI();
    if (this.health <= 0 || this.y > 3000) {
      if (this.health <= 0) addKill("System", "You");
      this.reset();
      syncMyPos();
    }

    if (w.ammo <= 0 && w.reserve > 0 && !this.isReloading) {
      this.reload();
    }

    if (
      keys["KeyR"] &&
      !this.isReloading &&
      w.ammo < w.maxAmmo &&
      w.reserve > 0
    ) {
      this.reload();
    }
  }

  checkCollisions(isX) {
    if (isX) this.onWall = 0;
    if (!isX) this.grounded = false;
    platforms.forEach((p) => {
      if (
        this.x < p.x + p.w &&
        this.x + this.w > p.x &&
        this.y < p.y + p.h &&
        this.y + this.h > p.y
      ) {
        if (isX) {
          if (this.velX > 0) {
            this.x = p.x - this.w;
            if (!this.grounded) this.onWall = 1;
          } else if (this.velX < 0) {
            this.x = p.x + p.w;
            if (!this.grounded) this.onWall = -1;
          }
          this.velX = 0;
        } else {
          if (this.velY > 0) {
            this.y = p.y - this.h;
            this.grounded = true;
            this.jumps = 0;
          } else if (this.velY < 0) {
            this.y = p.y + p.h;
          }
          this.velY = 0;
        }
      }
    });
  }

  shoot() {
    let w = WEAPONS[this.weaponKey];
    let worldM = {
      x: mouse.x / camera.zoom + camera.x,
      y: mouse.y / camera.zoom + camera.y,
    };

    if (this.weaponKey == 3) {
      if (!mouse.right) return;
      this.lastShotTrail = {
        x1: this.x + 15,
        y1: this.y + 20,
        x2: worldM.x,
        y2: worldM.y,
        timer: 8,
      };

      for (let id in remotePlayers) {
        let p = remotePlayers[id];
        if (
          worldM.x > p.x &&
          worldM.x < p.x + 30 &&
          worldM.y > p.y &&
          worldM.y < p.y + 45
        ) {
          dealDamage(id, w.damage);
        }
      }
    } else {
      let baseAngle = Math.atan2(
        worldM.y - (this.y + 20),
        worldM.x - (this.x + 15)
      );
      bullets.push(
        new Bullet(
          this.x + 15,
          this.y + 20,
          baseAngle + (Math.random() - 0.5) * w.spread,
          "player",
          w.damage,
          w.speed
        )
      );
    }
    w.ammo--;
    this.fireTimer = w.rate;
    syncMyPos();
  }

  reload() {
    this.isReloading = true;
    setTimeout(() => {
      let w = WEAPONS[this.weaponKey];
      let take = Math.min(w.maxAmmo - w.ammo, w.reserve);
      w.ammo += take;
      w.reserve -= take;
      this.isReloading = false;
    }, 1200);
  }

  updateUI() {
    const blueColor = "#3498db";
    const redColor = "#e74c3c";

    // 1. ОБНОВЛЕНИЕ HP
    const hpHud = document.getElementById("hp-hud");
    const hpValue = document.getElementById("hp-value");
    if (hpValue && hpHud) {
      hpValue.innerText = Math.max(0, Math.floor(this.health));

      // Если HP < 30 — краснеет
      if (this.health < 30) {
        hpHud.style.borderColor = redColor;
        hpHud.style.color = redColor;
      } else {
        hpHud.style.borderColor = blueColor;
        hpHud.style.color = blueColor;
      }
    }

    // 2. ОБНОВЛЕНИЕ ПАТРОНОВ
    const ammoHud = document.getElementById("ammo-hud");
    const ammoCurr = document.getElementById("ammo-current");
    const ammoRes = document.getElementById("ammo-reserve");
    let w = WEAPONS[this.weaponKey];

    if (ammoHud && ammoCurr && ammoRes) {
      ammoCurr.innerText = this.isReloading ? "..." : w.ammo;
      ammoRes.innerText = "/ " + w.reserve;

      // Проверка: меньше 30% магазина
      const lowAmmoLimit = w.maxAmmo * 0.3;
      if (w.ammo <= lowAmmoLimit && !this.isReloading) {
        ammoHud.style.borderColor = redColor;
        ammoHud.style.color = redColor;
      } else {
        ammoHud.style.borderColor = blueColor;
        ammoHud.style.color = blueColor;
      }
    }

    // 3. ОБНОВЛЕНИЕ РЫВКА (уже настроено ранее, убеждаемся в цветах)
    const dashBar = document.getElementById("dash-bar");
    const dashStatus = document.getElementById("dash-status");
    const dashHud = document.getElementById("dash-hud");

    if (dashHud && dashBar && dashStatus) {
      if (this.dashCooldown <= 0) {
        dashHud.style.borderColor = blueColor;
        dashStatus.style.color = blueColor;
        dashBar.style.background = blueColor;
        dashBar.style.width = "100%";
        dashStatus.innerText = "РЫВОК: ГОТОВ";
      } else {
        let progress = 1 - this.dashCooldown / DASH_COOLDOWN_TIME;
        dashHud.style.borderColor = redColor;
        dashStatus.style.color = redColor;
        dashBar.style.background = redColor;
        dashBar.style.width = progress * 100 + "%";
        dashStatus.innerText = `РЫВОК: ${(this.dashCooldown / 60).toFixed(1)}с`;
      }
    }

    // Оружие справа
    document.querySelectorAll(".weapon-item").forEach((el) => {
      el.classList.toggle("active", el.id.split("-")[1] == this.weaponKey);
    });
  }

  draw() {
    this.afterimages.forEach((img) => {
      ctx.fillStyle = `rgba(52, 152, 219, ${img.opacity})`;
      ctx.fillRect(img.x, img.y, this.w, this.h);
    });
    ctx.fillStyle = "#3498db";
    ctx.fillRect(this.x, this.y, this.w, this.h);
  }
}

class Bullet {
  constructor(x, y, angle, owner, dmg, speed) {
    this.x = x;
    this.y = y;
    this.owner = owner;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.damage = dmg;
    this.active = true;
  }
  update() {
    this.x += this.vx;
    this.y += this.vy;
    if (
      platforms.some(
        (p) =>
          this.x > p.x &&
          this.x < p.x + p.w &&
          this.y > p.y &&
          this.y < p.y + p.h
      )
    ) {
      this.active = false;
    }
  }
}

this.jumpKeyReleased = true;
function initGame() {
  player = new Player();
  bullets = [];
  const wallThickness = 2500;
  platforms = [
    {
      x: -wallThickness,
      y: WORLD_HEIGHT,
      w: WORLD_WIDTH + wallThickness * 2,
      h: wallThickness,
    },
    {
      x: -wallThickness,
      y: -wallThickness,
      w: WORLD_WIDTH + wallThickness * 2,
      h: wallThickness,
    },
    { x: -wallThickness, y: 0, w: wallThickness, h: WORLD_HEIGHT },
    { x: WORLD_WIDTH, y: 0, w: wallThickness, h: WORLD_HEIGHT },
    { x: 0, y: 2350, w: 600, h: 40 },
    { x: 3400, y: 2350, w: 600, h: 40 },
    { x: 700, y: 2200, w: 300, h: 40 },
    { x: 3000, y: 2200, w: 300, h: 40 },
    { x: 1700, y: 2300, w: 600, h: 40 },
    { x: 1850, y: 2150, w: 300, h: 40 },
    { x: 1500, y: 2000, w: 1000, h: 60 },
    { x: 1100, y: 2300, w: 200, h: 30 },
    { x: 2700, y: 2300, w: 200, h: 30 },
    { x: 400, y: 1950, w: 400, h: 40 },
    { x: 3200, y: 1950, w: 400, h: 40 },
    { x: 900, y: 1800, w: 300, h: 40 },
    { x: 2800, y: 1800, w: 300, h: 40 },
    { x: 1900, y: 1750, w: 200, h: 30 },
    { x: 2100, y: 1600, w: 200, h: 30 },
    { x: 0, y: 1600, w: 300, h: 40 },
    { x: 300, y: 1400, w: 200, h: 40 },
    { x: 0, y: 1200, w: 250, h: 40 },
    { x: 400, y: 1000, w: 200, h: 500 },
    { x: 100, y: 750, w: 300, h: 40 },
    { x: 400, y: 550, w: 200, h: 40 },
    { x: 3700, y: 1600, w: 300, h: 40 },
    { x: 3500, y: 1400, w: 200, h: 40 },
    { x: 3750, y: 1200, w: 250, h: 40 },
    { x: 3400, y: 1000, w: 200, h: 500 },
    { x: 3600, y: 750, w: 300, h: 40 },
    { x: 3400, y: 550, w: 200, h: 40 },
    { x: 1000, y: 1300, w: 2000, h: 40 },
    { x: 1300, y: 1050, w: 400, h: 40 },
    { x: 2300, y: 1050, w: 400, h: 40 },
    { x: 1500, y: 850, w: 1000, h: 40 },
    { x: 1500, y: 1500, w: 100, h: 30 },
    { x: 2400, y: 1500, w: 100, h: 30 },
    { x: 1000, y: 1000, w: 200, h: 30 },
    { x: 2800, y: 1000, w: 200, h: 30 },
    { x: 800, y: 400, w: 600, h: 40 },
    { x: 2600, y: 400, w: 600, h: 40 },
    { x: 1850, y: 250, w: 300, h: 40 },
  ];
}

function update() {
  player.update();
  bullets.forEach((b, idx) => {
    b.update();
    if (b.owner === "player") {
      for (let id in remotePlayers) {
        let p = remotePlayers[id];
        if (b.x > p.x && b.x < p.x + 30 && b.y > p.y && b.y < p.y + 45) {
          dealDamage(id, b.damage);
          b.active = false;
        }
      }
    }
    if (!b.active) bullets.splice(idx, 1);
  });
  if (player.health > 0) syncMyPos();
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  let targetX, targetY;
  if (player.weaponKey == 3 && mouse.right) {
    camera.targetZoom = 1.8;
    const maxLook = 600;
    let offX = Math.max(
      -maxLook,
      Math.min(maxLook, (mouse.x - canvas.width / 2) / camera.zoom)
    );
    let offY = Math.max(
      -maxLook,
      Math.min(maxLook, (mouse.y - canvas.height / 2) / camera.zoom)
    );
    targetX = player.x - canvas.width / 2 / camera.zoom + offX;
    targetY = player.y - canvas.height / 2 / camera.zoom + offY;
  } else {
    camera.targetZoom = 1;
    targetX = player.x - canvas.width / 2;
    targetY = player.y - canvas.height / 2;
  }

  camera.x += (targetX - camera.x) * 0.1;
  camera.y += (targetY - camera.y) * 0.1;
  camera.zoom += (camera.targetZoom - camera.zoom) * 0.25;

  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(
    -camera.x - canvas.width / 2 / camera.zoom,
    -camera.y - canvas.height / 2 / camera.zoom
  );

  platforms.forEach((p) => {
    ctx.fillStyle = "#2c3e50";
    ctx.fillRect(p.x, p.y, p.w, p.h);
  });

  if (player.weaponKey < 3) {
    let worldM = {
      x: mouse.x / camera.zoom + camera.x,
      y: mouse.y / camera.zoom + camera.y,
    };
    let angle = Math.atan2(
      worldM.y - (player.y + 20),
      worldM.x - (player.x + 15)
    );

    // Находим точку удара луча
    let beamEnd = getRayIntersection(
      player.x + 15,
      player.y + 20,
      angle,
      platforms
    );

    ctx.strokeStyle = "rgba(52, 152, 219, 0.3)";
    ctx.setLineDash([10, 5]);
    ctx.beginPath();
    ctx.moveTo(player.x + 15, player.y + 20);
    ctx.lineTo(beamEnd.x, beamEnd.y); // Теперь луч идет до препятствия
    ctx.stroke();

    // Рисуем маленькую точку в месте соприкосновения для четкости
    ctx.fillStyle = "rgba(52, 152, 219, 0.5)";
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(beamEnd.x, beamEnd.y, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Отрисовка других игроков
  for (let id in remotePlayers) {
    let p = remotePlayers[id];

    // Моделька врага
    ctx.fillStyle = "#e74c3c";
    ctx.fillRect(p.x, p.y, 30, 45);

    // Никнейм
    ctx.fillStyle = "white";
    ctx.font = "bold 14px Arial";
    ctx.textAlign = "center";
    ctx.fillText(p.nickname || "Player", p.x + 15, p.y - 25); // Подняли чуть выше

    // Полоска здоровья над головой врага
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(p.x - 5, p.y - 15, 40, 6); // Фон полоски
    ctx.fillStyle = p.health > 30 ? "#2ecc71" : "#e74c3c"; // Зеленый если много HP, красный если мало
    let hpWidth = (Math.max(0, p.health) / 100) * 40;
    ctx.fillRect(p.x - 5, p.y - 15, hpWidth, 6); // Сама полоска
  }

  player.draw();
  bullets.forEach((b) => {
    ctx.fillStyle = "cyan";
    ctx.beginPath();
    ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
    ctx.fill();
  });

  if (player.lastShotTrail && player.lastShotTrail.timer > 0) {
    ctx.strokeStyle = `rgba(255,255,255,${player.lastShotTrail.timer / 8})`;
    ctx.beginPath();
    ctx.moveTo(player.lastShotTrail.x1, player.lastShotTrail.y1);
    ctx.lineTo(player.lastShotTrail.x2, player.lastShotTrail.y2);
    ctx.stroke();
    player.lastShotTrail.timer--;
  }
  ctx.restore();

  // ВОТ ОН, ТВОЙ ЛЮБИМЫЙ ПРИЦЕЛ AWP
  if (player.weaponKey == 3 && mouse.right) {
    // Черный фон с дыркой
    ctx.fillStyle = "black";
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    ctx.arc(mouse.x, mouse.y, 250, 0, Math.PI * 2, true);
    ctx.fill();

    // Перекрестие
    ctx.strokeStyle = "black";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(mouse.x - 250, mouse.y);
    ctx.lineTo(mouse.x + 250, mouse.y);
    ctx.moveTo(mouse.x, mouse.y - 250);
    ctx.lineTo(mouse.x, mouse.y + 250);
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  requestAnimationFrame(() => {
    update();
    draw();
  });
}

// Сетевые функции
function syncMyPos() {
  if (
    !window.db ||
    !window.playerId ||
    document.getElementById("login-screen").style.display !== "none"
  )
    return;
  const { ref, set } = window.fbOps;
  set(ref(window.db, "players/" + window.playerId), {
    x: player.x,
    y: player.y,
    health: player.health,
    nickname: myNickname,
    weaponKey: player.weaponKey,
    lastUpdate: Date.now(),
  });
}

function initMultiplayer() {
  const { ref, onChildAdded, onChildChanged, onChildRemoved } = window.fbOps;
  const playersRef = ref(window.db, "players/");

  onChildAdded(playersRef, (snapshot) => {
    if (snapshot.key !== window.playerId)
      remotePlayers[snapshot.key] = snapshot.val();
  });

  onChildChanged(playersRef, (snapshot) => {
    if (snapshot.key === window.playerId) {
      // Если в базе HP стало 0, а у нас еще нет - умираем
      if (snapshot.val().health <= 0 && player.health > 0) {
        player.health = 0;
      }
    } else {
      remotePlayers[snapshot.key] = snapshot.val();
    }
  });

  onChildRemoved(playersRef, (snapshot) => {
    delete remotePlayers[snapshot.key];
  });
}

// Старт игры
document.getElementById("start-game-btn").onclick = () => {
  const input = document.getElementById("nickname-input").value;
  if (input.trim() !== "") {
    myNickname = input;
    document.getElementById("login-screen").style.display = "none";
    initMultiplayer();
  }
};

window.addEventListener("keydown", (e) => {
  if (player.dashCooldown <= 0) {
    const now = Date.now();
    if (e.code === "KeyA" && now - player.lastA < 250 && player.canDashA) {
      player.velX = -42;
      player.dashTimer = 10;
      player.dashCooldown = DASH_COOLDOWN_TIME;
    }
    if (e.code === "KeyD" && now - player.lastD < 250 && player.canDashD) {
      player.velX = 42;
      player.dashTimer = 10;
      player.dashCooldown = DASH_COOLDOWN_TIME;
    }
    if (e.code === "KeyA") {
      player.lastA = now;
      player.canDashA = false;
    }
    if (e.code === "KeyD") {
      player.lastD = now;
      player.canDashD = false;
    }
  }
  keys[e.code] = true;
});

window.addEventListener("keyup", (e) => {
  keys[e.code] = false;
  if (e.code === "KeyA") player.canDashA = true;
  if (e.code === "KeyD") player.canDashD = true;
});

window.addEventListener("mousemove", (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});
window.addEventListener("mousedown", (e) => {
  if (e.button === 0) mouse.left = true;
  if (e.button === 2) mouse.right = true;
});
window.addEventListener("mouseup", (e) => {
  if (e.button === 0) mouse.left = false;
  if (e.button === 2) mouse.right = false;
});

window.oncontextmenu = () => false;
initGame();
draw();

// ЛУЧ
function getRayIntersection(x1, y1, angle, platforms) {
  let closestDist = 2000; // Максимальная длина луча
  let endX = x1 + Math.cos(angle) * closestDist;
  let endY = y1 + Math.sin(angle) * closestDist;

  platforms.forEach((p) => {
    // Проверяем пересечение с каждой из 4 сторон прямоугольника
    const lines = [
      { x1: p.x, y1: p.y, x2: p.x + p.w, y2: p.y }, // Верх
      { x1: p.x, y1: p.y + p.h, x2: p.x + p.w, y2: p.y + p.h }, // Низ
      { x1: p.x, y1: p.y, x2: p.x, y2: p.y + p.h }, // Лево
      { x1: p.x + p.w, y1: p.y, x2: p.x + p.w, y2: p.y + p.h }, // Право
    ];

    lines.forEach((l) => {
      const intersection = findLineIntersection(
        x1,
        y1,
        endX,
        endY,
        l.x1,
        l.y1,
        l.x2,
        l.y2
      );
      if (intersection) {
        const dist = Math.hypot(intersection.x - x1, intersection.y - y1);
        if (dist < closestDist) {
          closestDist = dist;
          endX = intersection.x;
          endY = intersection.y;
        }
      }
    });
  });

  return { x: endX, y: endY };
}

// Вспомогательная математика пересечения двух отрезков
function findLineIntersection(x1, y1, x2, y2, x3, y3, x4, y4) {
  const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (den === 0) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / den;
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
  }
  return null;
}
