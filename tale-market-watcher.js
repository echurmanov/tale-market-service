"use strict";

const Promise = require('bluebird');
const EventEmitter = require('events');


const WATCH_CHECK_DELAY = 300; //ms
const WATCH_SYNC_PERIOD = 20; //watch to sync

const EVENT = {
  LOT_SOLD: "LOT_SOLD",
  LOT_PLACE: "LOT_PLACE",
  LOT_EXPIRED: "LOT_EXPIRED",
  STATS_UPDATED: "STATS_UPDATED"
};

class TaleMarketWatcher extends EventEmitter
{
  constructor(account) {
    super();
    this.account = account;
    this.lots = {};
    this.lotCardMap = {};
    this.knownLotsIds = [];
    this.watch = false;
    this.watchesToSync = WATCH_SYNC_PERIOD;
    this.lastMarketKnownPage = 0;
    this.lastSoldLot = '';
  }

  /**
   * Отправка запроса на получение стараницы ранка
   * @param page
   * @returns {Promise}
   */
  getMarketPageRequest(page) {
    return new Promise((resolve, reject) =>{
      this.account.getPage("/market/?page="+page+"&order_by=5", (err, acc, body) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(body);
      });
    });
  }

  /**
   * Получение страницы с историей рынка
   *
   * @returns {Promise}
   */
  getMarketHistoryPageRequest() {
    return new Promise((resolve, reject) =>{
      this.account.getPage("/market/history", (err, acc, body) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(body);
      });
    });
  }


  /**
   * Помечаем все лоты как не подтвержденные
   */
  unConfirmLots() {
    for (let lotId in this.lots) {
      this.lots[lotId].confirmed = false;
    }
  }

  /**
   * Перестройка карты лотов на основе информации об известных лотах
   */
  rebuildCardLotMap() {
    this.lotCardMap = {};
    for (let lotId in this.lots) {
      if (this.lots[lotId].confirmed) {
        if (typeof this.lotCardMap[this.lots[lotId].cardName] == 'undefined') {
          this.lotCardMap[this.lots[lotId].cardName] = {
            cardName: this.lots[lotId].cardName,
            maxPrice: 0,
            minPrice: 0,
            avgPrice: 0,
            lots: []
          }
        }
        this.lotCardMap[this.lots[lotId].cardName].lots.push(this.lots[lotId]);
        this.lotCardMap[this.lots[lotId].cardName].avgPrice = (this.lotCardMap[this.lots[lotId].cardName].avgPrice
          * (this.lotCardMap[this.lots[lotId].cardName].lots.length - 1) + this.lots[lotId].price)
          / this.lotCardMap[this.lots[lotId].cardName].lots.length;

        this.lotCardMap[this.lots[lotId].cardName].avgPrice = Math.round(this.lotCardMap[this.lots[lotId].cardName].avgPrice);

        if (this.lotCardMap[this.lots[lotId].cardName].maxPrice < this.lots[lotId].price) {
          this.lotCardMap[this.lots[lotId].cardName].maxPrice = this.lots[lotId].price;
        }

        if (this.lotCardMap[this.lots[lotId].cardName].minPrice == 0
          || this.lotCardMap[this.lots[lotId].cardName].minPrice > this.lots[lotId].price
        ) {
          this.lotCardMap[this.lots[lotId].cardName].minPrice = this.lots[lotId].price;
        }
      }
    }
  }

  /**
   * Очистка памяти от лотов, наличе которых не было подтверждено
   */
  removeUnconfirmed()
  {
    for (let lotId in this.lots) {
      if (!this.lots[lotId].confirmed) {
        this.emit(EVENT.LOT_SOLD, this.lots[lotId]);
        delete(this.lots[lotId]);
        if (this.knownLotsIds.indexOf(lotId) != -1) {
          this.knownLotsIds.splice(this.knownLotsIds.indexOf(lotId), 1);
        }
      }
    }
  }

  /**
   * Для деьага
   */
  debugCardLotMap() {
    const lots = [];
    for(let cardName in this.lotCardMap) {
      const lot = this.lotCardMap[cardName];
      lots.push(cardName + " ("+lot.lots.length+")" +": " + "^" + lot.maxPrice + " v" + lot.minPrice + " =" + lot.avgPrice);
    }
    return lots;
  }

  /**
   * Парсит код сттарниц рынка и возвращает массив и лотами
   *
   *
   * @param pageBodies
   * @returns {Array}
   */
  parsePages(pageBodies) {
    const marketLotReg = /\<tr[^<]+\<td[^<]+\<span [^<]+card-label[^>]+\>\s+([^<]+)\s+\<\/span[^<]+\<[^<]+\<td>(\d+)\<\/td>[^<]+<[^<]+<span>([^<]+)<\/span><\/td>[^<]+<td>[^<]+<a\s+href=\"\/market\/(\d+)\/purchase\"/igm;
    const getPageNumberReg = /\<a href=\"\/market\/\?page=(\d+)[^<]+\<\/a[^<]+\<\/li[^<]+\<\/ul\>/im;
    const pageNumberRes = getPageNumberReg.exec(pageBodies[0]);
    if (pageNumberRes) {
      this.lastMarketKnownPage = 1 * pageNumberRes[1];
    }
    const result = [];
    for (let i = 0; i < pageBodies.length; i++) {
      let marketLotResult = marketLotReg.exec(pageBodies[i]);
      while (marketLotResult) {
        result.push({
          lotId: marketLotResult[4],
          cardName: marketLotResult[1],
          price: 1 * marketLotResult[2],
          timeLeft: marketLotResult[3],
          confirmed: true
        });
        marketLotResult = marketLotReg.exec(pageBodies[i]);
      }
    }
    return result;
  }


  /**
   * Выполнение синхронизации инфомрации о лотах в памяти с рынком Сказки
   * (Просматривает все тсраницы рынка)
   *
   * @returns {Promise}
   */
  syncWithMarket() {
    return new Promise((resolve, reject) => {
      this.account.getPage("/market/?page=1&order_by=5", (err, acc, body) => {
        if (err) {
          reject(err);
          return;
        }
        const getPageNumberReg = /\<a href=\"\/market\/\?page=(\d+)[^<]+\<\/a[^<]+\<\/li[^<]+\<\/ul\>/im;
        const pageNumberRes = getPageNumberReg.exec(body);
        if (pageNumberRes) {
          const pagesNumber = 1 * pageNumberRes[1];
          let pagesBodies = [body];
          const marketPageRequests = [];
          for (let i = 2; i <= pagesNumber; i++) {
            marketPageRequests.push(this.getMarketPageRequest(i))
          }
          Promise.all(marketPageRequests).then((bodies) => {
            pagesBodies = pagesBodies.concat(bodies);
            this.unConfirmLots();
            const lots = this.parsePages(pagesBodies);
            this.addLots(lots);
            this.rebuildCardLotMap();
            this.removeUnconfirmed();
            this.emit(EVENT.STATS_UPDATED, this.lotCardMap);
            resolve(this);
          });
        } else {
          reject(new Error("Unknown first page format"));
        }

      });
    });
  }

  /**
   * Добавляет информацию о лотах со тсраниц рынка в память
   *
   * @param lots
   * @returns {{oldLots: Array, newLots: Array}}
   */
  addLots(lots) {
    const newLots = [];
    const oldLots = [];
    for (let i = 0; i < lots.length; i++) {
      if (typeof this.lots[lots[i].lotId] == 'undefined') {
        this.lots[lots[i].lotId] = {
          lotId: lots[i].lotId,
          cardName: lots[i].cardName,
          price: 1 * lots[i].price,
          timeLeft: lots[i].timeLeft,
          confirmed: true
        };
        newLots.push(lots[i].lotId);
        this.knownLotsIds.push(lots[i].lotId);
        this.emit(EVENT.LOT_PLACE, this.lots[lots[i].lotId]);
      } else {
        this.lots[lots[i].lotId].confirmed = true;
        oldLots.push(lots[i].lotId);
      }
    }
    this.knownLotsIds.sort().reverse();
    return {
      oldLots: oldLots,
      newLots: newLots
    }
  }

  /**
   * Ищет новые позиции на рынке, начиная с указаной страницы, пока не упрется в уже известные лоты
   *
   * @param {number} page
   * @returns {Promise}
   */
  watchNewMarket(page) {
    if (typeof page == 'undefined') {
      page = 1;
    }
    return new Promise((resolve, reject)=>{
      this.getMarketPageRequest(page)
        .then((pageBody) => {
          const lots = this.parsePages([pageBody]);
          const addResult = this.addLots(lots);
          if (addResult.newLots.length != 0 && addResult.oldLots.length == 0) {
            this.watchNewMarket(page + 1).then((newLots) => {
              resolve(addResult.newLots.concat(newLots));
            });
          } else {
            resolve(addResult.newLots);
          }
        })
    });
  }

  /**
   * Проверяте последнию страницу рынка для вычисление лотов, вышедших по времени
   *
   * @returns {Promise}
   */
  watchOldMarket() {
    return new Promise((resolve, reject)=>{
      this.getMarketPageRequest(this.lastMarketKnownPage)
        .then((pageBody) => {
          const lots = this.parsePages([pageBody]);
          const lastLot = lots.pop();
          if (lastLot) {
            console.log("Last Lot: ", lastLot.lotId, lastLot.cardName);
            const lastIndex = this.knownLotsIds.indexOf(lastLot.lotId);
            if (lastIndex != -1 && lastIndex < this.knownLotsIds.length - 1) {
              const expireLots = this.knownLotsIds.splice(lastIndex);
              for (let i = 0; i < expireLots.length; i++) {
                this.emit(EVENT.LOT_EXPIRED, this.lots[expireLots[i]]);
                delete(this.lots[expireLots[i]]);
              }
              resolve(expireLots);
            } else {
              resolve([]);
            }
          } else{
            resolve([]);
          }
        });
    });
  }

  watchHistory() {
    return new Promise((resolve, reject)=>{
      this.getMarketHistoryPageRequest().then((body)=>{
        const lastLotReg = /\<td\>\<span [^\>]+\>\s*(.+)\s*\<\/span\>\s*\<\/td>\s*\<td\>\s*(\d+)\s*\<\/td\>\s*\<td\>\s*\<span\s+.+timestamp="(\d+\.?\d*)"/gmi;
        const lotRes = lastLotReg.exec(body);
        let newLot = false;
        if (lotRes) {
          const lotInfo = [lotRes[1], lotRes[2], lotRes[3]].join(", ");
          if (lotInfo != this.lastSoldLot) {
            newLot = true;
            this.lastSoldLot = lotInfo;
          }
        }
        resolve(newLot);
      })
    });
  }

  /**
   * Взвод и обработка таймера на очердуню обработку старниц рынка
   */
  requestWatch() {
    if (this.watch) {
      setTimeout(() => {
        if (this.watch) {
          this.watchesToSync--;
          if (this.watchesToSync == 0) {
            this.watchesToSync = WATCH_SYNC_PERIOD;
            this.syncWithMarket().then(()=>{
              this.requestWatch()
            });
          } else {
            this.watchHistory().then((newSoldItem)=>{
              if (newSoldItem) {
                this.watchesToSync = WATCH_SYNC_PERIOD;
                this.syncWithMarket().then(()=>{
                  this.requestWatch()
                });
              } else {
                this.watchNewMarket().then((newLots) => {
                  this.watchOldMarket().then((expiredLots)=>{
                    if (expiredLots.length > 0 || newLots.length > 0) {
                      this.rebuildCardLotMap();
                    }
                    this.requestWatch();
                  });
                });
              }
            });
          }
        }
      }, WATCH_CHECK_DELAY);
    }
  }

  /**
   * Заупск наблюдения за рынком
   * @returns {Promise}
   */
  startWatch() {
    return new Promise((resolve, reject) => {
      this.watchHistory().then(() => {
        this.syncWithMarket()
          .then((watcher)=>{
            watcher.watch = true;
            this.watchesToSync = WATCH_SYNC_PERIOD;
            this.requestWatch();
            resolve();
          })
          .catch(reject);
      });
    });
  }
}

module.exports = {
  TaleMarketWatcher: TaleMarketWatcher
};