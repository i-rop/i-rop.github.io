
// code replaces this html

//    <div class="image">
//        <div class= "image2"><img src="images/logo3.png" alt="" height= "100" width= "150" /> </div>
//            <!--  <div class="brand">i-ROP</div>    --> <!-- if you want just a plain black "i-ROP" title -->
//        <div class="address-bar"><small>Imaging and Informatics of Retinopathy of Prematurity</small></div>
//    </div>

(function() {

    var addr_bar = $('<div class="address-bar"><small>Imaging and Informatics in Retinopathy of Prematurity</small></div>');

    var img_div = $('<div class= "image2"><img src="images/logo3.png" alt="" height= "100" width= "150" /> </div>');
    img_div.append(addr_bar);
    
    var top_div = $('<div class="image">');
    top_div.append(img_div);

    $("#titleImg").append(top_div);

})();
