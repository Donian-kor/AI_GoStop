'use strict';

(function (root) {
  root.GostopApiClient = function () {
    function request(method, url, body, onOk, onErr) {
      var xhr = new root.XMLHttpRequest();
      try {
        xhr.open(method, url, true);
      } catch (e) {
        if (onErr) onErr();
        return;
      }
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.withCredentials = true;
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        if (xhr.status >= 200 && xhr.status < 300) {
          var data = null;
          try { data = JSON.parse(xhr.responseText); } catch (e) { data = null; }
          if (onOk) onOk(data);
        } else if (onErr) {
          onErr(xhr);
        }
      };
      xhr.onerror = function () { if (onErr) onErr(xhr); };
      try {
        xhr.send(body ? JSON.stringify(body) : null);
      } catch (e) {
        if (onErr) onErr(xhr);
      }
    }

    return {
      getJson: function (url, onOk, onErr) { request('GET', url, null, onOk, onErr); },
      postJson: function (url, body, onOk, onErr) { request('POST', url, body, onOk, onErr); }
    };
  };
})(window);
